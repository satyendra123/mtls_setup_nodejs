/**
 * test-request.mjs — mTLS test client (Windows curl/schannel PEM cert load nahi kar pata,
 * isliye Node ke https module se seedha mTLS request banate hain)
 *
 * Usage:
 *   node test-request.mjs <bank|toll> <GET|POST> <path> ['<json-body>']
 *
 * Examples:
 *   node test-request.mjs toll GET  "/health"
 *   node test-request.mjs toll GET  "/api/send-payment?vehicle=MH12AB1234&amount=50"
 *   node test-request.mjs toll POST "/api/fasttag/payment" '{"tagid":"TAG1","tid":"TID1","vehno":"MH12AB1234","toll_fare":"65.00"}'
 *
 * Note: agar path me & ho to use double-quotes me rakho. Git Bash me leading "/"
 * paths ko MSYS path-conversion se bachane ke liye command se pehle
 * MSYS_NO_PATHCONV=1 lagao (sirf Windows Git Bash pe zaroori hai).
 */

import https from 'https';
import fs from 'fs';

const [, , side, method, path, jsonBody] = process.argv;

if (!side || !method || !path) {
  console.error('Usage: node test-request.mjs <bank|toll> <GET|POST> <path> [json-body]');
  process.exit(1);
}

const root = side === 'bank' ? 'bank/ca' : 'toll/ca';
const body = jsonBody ? Buffer.from(jsonBody, 'utf8') : null;

const opts = {
  hostname: 'localhost',
  port: side === 'bank' ? 8443 : 9443,
  path,
  method: method.toUpperCase(),
  cert: fs.readFileSync(`${root}/client.crt`),
  key:  fs.readFileSync(`${root}/client.key`),
  ca:   fs.readFileSync(`${root}/ca.crt`),
  headers: body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {},
};

const r = https.request(opts, (res) => {
  let data = '';
  res.on('data', c => data += c);
  res.on('end', () => {
    console.log('STATUS', res.statusCode);
    try { console.log(JSON.stringify(JSON.parse(data), null, 2)); }
    catch { console.log(data); }
  });
});
r.on('error', e => console.error('ERROR', e.message));
if (body) r.write(body);
r.end();
