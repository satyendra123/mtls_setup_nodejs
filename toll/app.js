/**
 * ============================================================
 *  TOLL SERVER — app.js
 *  Bhagat Toll Plaza | https://localhost:9443
 * ============================================================
 */
// dotenv config.js me load hota hai (explicit path ke saath)
import https   from 'https';
import fs      from 'fs';
import express from 'express';
import { fileURLToPath } from 'url';
import path    from 'path';
import config  from './config/config.js';
import routes  from './routes/routes.js';
import * as NetcRuntimeService from './services/NetcRuntimeService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.text({ type: '*/*', limit: '10mb' }));
app.use(routes);

// ── mTLS HTTPS Server ──────────────────────────────────────
// Files used (toll/ca/ se):
//   server.crt / server.key → Toll ka HTTPS server
//   ca.crt                  → CA (bank ke client cert verify karne ke liye)
//
//   Bank ab heartbeat/synctime ke liye toll ko bhi callback karta hai,
//   isliye toll side bhi mTLS enforce karta hai (requestCert: true)
const serverOptions = {
  cert: fs.readFileSync(config.tls.serverCert),  // toll/ca/server.crt
  key:  fs.readFileSync(config.tls.serverKey),   // toll/ca/server.key
  ca:   fs.readFileSync(config.tls.caCert),      // toll/ca/ca.crt
  requestCert:        true,
  rejectUnauthorized: true,
};

https.createServer(serverOptions, app).listen(config.port, config.host, () => {
  console.log('');
  console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
  console.log('  TOLL SERVER (Bhagat Toll Plaza) — https://localhost:' + config.port);
  console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
  console.log('');
  console.log('  Certificates : toll/ca/');
  console.log('    server.crt           — HTTPS server certificate');
  console.log('    client.crt           — mTLS client cert (bank ko bhejta hai)');
  console.log('    ca.crt               — CA (bank ka server cert verify karne ke liye)');
  console.log('    toll-pgp-private.asc — PGP decrypt');
  console.log('    bank-pgp-public.asc  — Bank ke liye PGP encrypt');
  console.log('    toll-sign.key        — XML sign');
  console.log('    bank-verify.pub      — Bank ka XML sig verify');
  console.log('');
  console.log('  ENDPOINTS (toll → bank, full pipeline):');
  console.log('    GET  /api/send-payment?vehicle=MH12AB1234&amount=50');
  console.log('    POST /api/fasttag/payment   { tagid, tid, vehno, vehicleclass, toll_fare, lane_id }  ← Postman/RFID reader');
  console.log('    GET  /api/send-check-txn?txnId=TXN-...');
  console.log('    GET  /api/send-refund?txnId=TXN-...&reason=CUSTOMER_REQUEST');
  console.log('    GET  /api/send-list-account?vehicle=MH12AB1234');
  console.log('    GET  /api/send-heartbeat');
  console.log('    GET  /api/send-synctime');
  console.log('');
  console.log('  ENDPOINTS (bank → toll, server side):');
  console.log('    POST /api/heartbeat');
  console.log('    POST /api/synctime');
  console.log('    GET  /health');
  console.log('');

  NetcRuntimeService.start();
});
