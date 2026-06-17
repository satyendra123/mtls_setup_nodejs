/**
 * NetcRuntimeService.js — Heartbeat/SyncTime background scheduler
 *
 * Real NPCI NETC integrations me Heartbeat/SyncTime kabhi manual HTTP call
 * se nahi chalte — ek background service hota hai jo server start hote hi
 * pehli baar fire karta hai, fir ek fixed interval pe repeat karta hai.
 * Yahan wahi pattern hai (NETC_HEARTBEAT_INTERVAL_SEC / NETC_TIME_SYNC_INTERVAL_SEC
 * env var naming real production system jaisa hi rakha hai).
 *
 * Real prod defaults: heartbeat 300s (5 min), time sync 14400s (4 hr).
 * Local learning/demo me dekhna easy banane ke liye yahan defaults chhote
 * rakhe hain — .env me override kar sakte ho.
 */

import * as HeartbeatController from '../controllers/HeartbeatController.js';
import * as SyncTimeController  from '../controllers/SyncTimeController.js';

let heartbeatTimer = null;
let timeSyncTimer  = null;

function getHeartbeatIntervalMs() {
  return Math.max(Number(process.env.NETC_HEARTBEAT_INTERVAL_SEC || 30), 0) * 1000;
}

function getTimeSyncIntervalMs() {
  return Math.max(Number(process.env.NETC_TIME_SYNC_INTERVAL_SEC || 300), 0) * 1000;
}

export function start() {
  console.log('  [NETC_RUNTIME] Heartbeat/SyncTime background scheduler shuru ho raha hai');
  console.log(`    Heartbeat har ${getHeartbeatIntervalMs() / 1000}s  (real prod default: 300s)`);
  console.log(`    SyncTime  har ${getTimeSyncIntervalMs() / 1000}s  (real prod default: 14400s)`);

  // Real NetcRuntimeService.start() jaisa — startup pe ek baar turant fire
  void HeartbeatController.runHeartbeat();
  void SyncTimeController.runSyncTime();

  const heartbeatIntervalMs = getHeartbeatIntervalMs();
  if (heartbeatIntervalMs > 0) {
    heartbeatTimer = setInterval(() => {
      void HeartbeatController.runHeartbeat();
    }, heartbeatIntervalMs);
  }

  const timeSyncIntervalMs = getTimeSyncIntervalMs();
  if (timeSyncIntervalMs > 0) {
    timeSyncTimer = setInterval(() => {
      void SyncTimeController.runSyncTime();
    }, timeSyncIntervalMs);
  }
}

export function stop() {
  clearInterval(heartbeatTimer);
  clearInterval(timeSyncTimer);
}
