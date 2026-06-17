import express from 'express';
import * as PaymentController   from '../controllers/PaymentController.js';
import * as HeartbeatController from '../controllers/HeartbeatController.js';
import * as SyncTimeController  from '../controllers/SyncTimeController.js';
import * as TxnController       from '../controllers/TxnController.js';
import * as AccountController   from '../controllers/AccountController.js';

const router = express.Router();

// Toll → Bank (client side, toll initiates)
router.get('/api/send-payment',      PaymentController.sendPayment);
router.post('/api/fasttag/payment',  PaymentController.vehicleEntry);
router.get('/api/send-check-txn',    TxnController.sendChkTxn);
router.get('/api/send-refund',       TxnController.sendRefund);
router.get('/api/send-list-account', AccountController.sendListAccount);
router.get('/api/send-heartbeat',    HeartbeatController.sendHeartbeat);
router.get('/api/send-synctime',     SyncTimeController.sendSyncTime);

// Bank → Toll (server side, bank initiates)
router.post('/api/heartbeat', HeartbeatController.receiveHeartbeat);
router.post('/api/synctime',  SyncTimeController.receiveSyncTime);

router.get('/health', PaymentController.healthCheck);

export default router;
