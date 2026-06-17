/**
 * PaymentController.js — Bank ka payment request handler
 *
 * Route: POST /api/payment
 *
 * Steps:
 *  1. mTLS  — Toll ka client certificate verify (automatic, HTTPS layer)
 *  2. PGP Decrypt   — bank/ca/bank-pgp-private.asc se
 *  3. XML Sig Verify — bank/ca/toll-verify.pub se
 *  4. Payment Process
 *  5. XML Sign      — bank/ca/bank-sign.key se
 *  6. PGP Encrypt   — bank/ca/toll-pgp-public.asc se
 *  7. Response bhejo
 */

import * as PaymentService from '../services/PaymentService.js';
import * as transactionStore from '../store/transactionStore.js';

export async function receivePayment(req, res) {
  try {
    console.log('\n████████████████████████████████████████████████████████████');
    console.log('  BANK: Payment Request Received from Toll');
    console.log('████████████████████████████████████████████████████████████');

    // ── STEP 1: mTLS certificate check ────────────────────
    // requestCert:true hone se ye automatically verify ho chuka hai
    // Hum sirf log kar rahe hain
    const clientCert = req.socket.getPeerCertificate();
    console.log('\n  [mTLS] Client Certificate:');
    console.log(`    CN         : ${clientCert.subject?.CN}`);
    console.log(`    Issuer     : ${clientCert.issuer?.CN}`);
    console.log(`    Valid To   : ${new Date(clientCert.valid_to).toDateString()}`);
    console.log('    ✓ Toll ka certificate CA se verified hai\n');

    // ── STEP 2: PGP Decrypt ───────────────────────────────
    console.log('  [PGP] Decrypt kar raha hai (bank/ca/bank-pgp-private.asc)...');
    const { data: decrypted, pgpSigValid } = await PaymentService.pgpDecrypt(req.body);
    console.log(`    ✓ PGP Decrypt: SUCCESS`);
    console.log(`    ✓ PGP Signature (Toll identity): ${pgpSigValid ? 'VALID' : 'UNVERIFIED'}`);

    // ── STEP 3: XML Signature Verify ──────────────────────
    const payload = JSON.parse(decrypted);
    console.log(`\n  [XML Sig] Verify kar raha hai (bank/ca/toll-verify.pub)...`);
    console.log(`    Transaction ID: ${payload.transactionId}`);
    const xmlOk = PaymentService.verifyXmlSig(payload.xml, payload.xmlSignature);
    if (!xmlOk) return res.status(400).send('XML signature invalid — request reject!');
    console.log('    ✓ XML Signature: VALID — Data tamper nahi hua');

    // ── STEP 4: Decrypted XML ─────────────────────────────
    console.log('\n  [XML] Payment Request:');
    console.log(payload.xml);

    // ── STEP 5: Payment Process ───────────────────────────
    const authCode   = 'AUTH-' + Date.now();
    const bankRef    = 'BANKREF-' + Math.random().toString(36).slice(2, 10).toUpperCase();
    const processedAt = new Date().toISOString();
    console.log(`\n  [Process] Auth: ${authCode}  Ref: ${bankRef}`);

    transactionStore.saveTransaction({
      transactionId: payload.transactionId,
      status: 'SUCCESS',
      authCode,
      bankRef,
      processedAt,
    });

    // ── STEP 6: Response XML banana + Sign karna (RespPay) ─
    // Real NPCI NETC me bank/NPCI ka response "RespPay" schema follow
    // karta hai: Head/Txn/Resp, values attributes me (result, respCode)
    const responseXml = `<RespPay>
  <Head msgId="${payload.transactionId}" orgId="ABCBANK" ts="${processedAt}" ver="1.0"/>
  <Txn id="${payload.transactionId}" ts="${processedAt}" type="DEBIT"/>
  <Resp result="ACCEPTED" respCode="00" authCode="${authCode}" bankRef="${bankRef}"/>
</RespPay>`;

    console.log('\n  [XML Sig] Response sign kar raha hai (bank/ca/bank-sign.key)...');
    const responseXmlSig = PaymentService.signXml(responseXml);
    console.log('    ✓ Response XML signed');

    // ── STEP 7: PGP Encrypt + Send ────────────────────────
    console.log('\n  [PGP] Encrypt kar raha hai (bank/ca/toll-pgp-public.asc)...');
    const encryptedResponse = await PaymentService.pgpEncrypt({
      transactionId: payload.transactionId,
      xml:           responseXml,
      xmlSignature:  responseXmlSig,
    });
    console.log('    ✓ Response encrypted, bhej raha hai toll ko...\n');

    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);

  } catch (err) {
    console.error('\n[BANK ERROR]', err.message);
    res.status(500).send(err.message);
  }
}

export function healthCheck(req, res) {
  res.json({ server: 'ABC Bank', port: 8443, mtls: true, status: 'running' });
}
