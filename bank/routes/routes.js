import express from 'express';
import * as PaymentController   from '../controllers/PaymentController.js';
import * as HeartbeatController from '../controllers/HeartbeatController.js';
import * as SyncTimeController  from '../controllers/SyncTimeController.js';
import * as TxnController       from '../controllers/TxnController.js';
import * as AccountController   from '../controllers/AccountController.js';

const router = express.Router();

// Toll → Bank (server side, full pipeline)
router.post('/api/payment',      PaymentController.receivePayment);
router.post('/api/check-txn',    TxnController.receiveChkTxn);
router.post('/api/refund',       TxnController.receiveRefund);
router.post('/api/list-account', AccountController.receiveListAccount);
router.post('/api/heartbeat',    HeartbeatController.receiveHeartbeat);
router.post('/api/synctime',     SyncTimeController.receiveSyncTime);

// Bank → Toll (client side, bank initiates)
router.get('/api/send-heartbeat', HeartbeatController.sendHeartbeat);
router.get('/api/send-synctime',  SyncTimeController.sendSyncTime);

router.get('/health', PaymentController.healthCheck);

export default router;
