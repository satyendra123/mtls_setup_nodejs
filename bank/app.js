/**
 * ============================================================
 *  BANK SERVER — app.js
 *  ABC Bank | https://localhost:8443 | mTLS ENABLED
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
app.use(express.text({ type: '*/*', limit: '10mb' })); // Raw body (PGP armored text)
app.use(routes);

// ── mTLS HTTPS Server ──────────────────────────────────────
//
//  mTLS = Mutual TLS
//  Normal HTTPS : Client server ka cert verify karta hai
//  mTLS         : DONO ek doosre ka cert verify karte hain
//
//  Files used (bank/ca/ se):
//    server.crt / server.key  → Bank ka HTTPS server certificate
//    ca.crt                   → CA cert (toll ke client cert verify karne ke liye)
//
//  requestCert: true        → Client se certificate maango
//  rejectUnauthorized: true → Invalid cert pe connection tod do
//
const serverOptions = {
  cert: fs.readFileSync(config.tls.serverCert),  // bank/ca/server.crt
  key:  fs.readFileSync(config.tls.serverKey),   // bank/ca/server.key
  ca:   fs.readFileSync(config.tls.caCert),      // bank/ca/ca.crt
  requestCert:        true,
  rejectUnauthorized: true,
};

https.createServer(serverOptions, app).listen(config.port, config.host, () => {
  console.log('');
  console.log('████████████████████████████████████████████████████████████');
  console.log('  BANK SERVER (ABC Bank) — https://localhost:' + config.port);
  console.log('████████████████████████████████████████████████████████████');
  console.log('');
  console.log('  mTLS         : ENABLED (requestCert=true)');
  console.log('  Certificates : bank/ca/');
  console.log('    server.crt     — HTTPS server certificate');
  console.log('    ca.crt         — CA (toll ke client cert verify karne ke liye)');
  console.log('    bank-pgp-private.asc — PGP decrypt');
  console.log('    toll-pgp-public.asc  — Toll PGP sig verify');
  console.log('    bank-sign.key        — XML sign');
  console.log('    toll-verify.pub      — Toll XML sig verify');
  console.log('');
  console.log('  ENDPOINTS (toll → bank, server side):');
  console.log('    POST /api/payment');
  console.log('    POST /api/check-txn');
  console.log('    POST /api/refund');
  console.log('    POST /api/list-account');
  console.log('    POST /api/heartbeat');
  console.log('    POST /api/synctime');
  console.log('');
  console.log('  ENDPOINTS (bank → toll, client side):');
  console.log('    GET  /api/send-heartbeat');
  console.log('    GET  /api/send-synctime');
  console.log('    GET  /health');
  console.log('');
  console.log('  Waiting for toll server to connect...');
  console.log('');

  NetcRuntimeService.start();
});
