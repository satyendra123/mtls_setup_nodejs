/**
 * TxnController.js — Toll ka transaction query/refund initiator
 *
 * sendChkTxn : GET /api/send-check-txn?txnId=TXN-...                       — status check
 * sendRefund : GET /api/send-refund?txnId=TXN-...&reason=CUSTOMER_REQUEST  — refund/reversal
 *
 * ReqChkTxn real NPCI NETC "etc:ReqChkTxn" schema follow karta hai
 * (Head/Txn/Ref, values attributes me). ReqRefund NPCI ka official message
 * type nahi hai (real NETC spec me per-txn refund request nahi milta) —
 * isliye sirf consistency ke liye wahi Head/Txn/Resp attribute style use
 * kiya hai, bina etc: namespace ke (taaki real NPCI element na lage).
 */

import * as PaymentService from '../services/PaymentService.js';

// ── Send ReqChkTxn ──────────────────────────────────────────
export async function sendChkTxn(req, res) {
  try {
    const transactionId = req.query.txnId;
    if (!transactionId) return res.status(400).json({ error: 'txnId query param required' });

    console.log(`\n[TOLL] Sending ReqChkTxn for ${transactionId}`);

    const msgId = `CHK-${Date.now()}`;
    const ts    = new Date().toISOString();
    const requestXml = `<etc:ReqChkTxn xmlns:etc="http://npci.org/etc/schema/">
  <Head msgId="${msgId}" orgId="BHGT" ts="${ts}" ver="1.0"/>
  <Txn id="${msgId}" note="" orgTxnId="${transactionId}" refId="BHAGAT-TOLL-PLAZA-01" refUrl="" ts="${ts}" type="Query">
    <Ref id="${transactionId}" ts="${ts}"/>
  </Txn>
</etc:ReqChkTxn>`;

    const xmlSignature = PaymentService.signXml(requestXml);
    const encrypted = await PaymentService.pgpEncrypt({ xml: requestXml, xmlSignature });

    const bankResponse = await PaymentService.sendToBank('/api/check-txn', encrypted);
    const { data: decrypted, pgpSigValid } = await PaymentService.pgpDecrypt(bankResponse);
    const respPayload = JSON.parse(decrypted);
    const xmlOk = PaymentService.verifyXmlSig(respPayload.xml, respPayload.xmlSignature);

    console.log(`  [PGP sig] ${pgpSigValid ? 'VALID' : 'UNVERIFIED'}   [XML sig] ${xmlOk ? 'VALID' : 'INVALID'}`);
    console.log(respPayload.xml);

    res.json({ success: true, transactionId, xmlValid: xmlOk, response: respPayload.xml });
  } catch (err) {
    console.error('\n[TOLL ERROR][ChkTxn send]', err.message);
    if (err.code === 'ECONNREFUSED') console.error('  Bank server nahi chal raha!');
    res.status(500).json({ error: err.message });
  }
}

// ── Send ReqRefund ──────────────────────────────────────────
export async function sendRefund(req, res) {
  try {
    const transactionId = req.query.txnId;
    const reason = req.query.reason || 'CUSTOMER_REQUEST';
    if (!transactionId) return res.status(400).json({ error: 'txnId query param required' });

    console.log(`\n[TOLL] Sending ReqRefund for ${transactionId} (${reason})`);

    const msgId = `RFD-${Date.now()}`;
    const ts    = new Date().toISOString();
    const requestXml = `<ReqRefund>
  <Head msgId="${msgId}" orgId="BHGT" ts="${ts}" ver="1.0"/>
  <Txn id="${msgId}" orgTxnId="${transactionId}" ts="${ts}" type="Reversal" note="${reason}"/>
</ReqRefund>`;

    const xmlSignature = PaymentService.signXml(requestXml);
    const encrypted = await PaymentService.pgpEncrypt({ xml: requestXml, xmlSignature });

    const bankResponse = await PaymentService.sendToBank('/api/refund', encrypted);
    const { data: decrypted, pgpSigValid } = await PaymentService.pgpDecrypt(bankResponse);
    const respPayload = JSON.parse(decrypted);
    const xmlOk = PaymentService.verifyXmlSig(respPayload.xml, respPayload.xmlSignature);

    console.log(`  [PGP sig] ${pgpSigValid ? 'VALID' : 'UNVERIFIED'}   [XML sig] ${xmlOk ? 'VALID' : 'INVALID'}`);
    console.log(respPayload.xml);

    res.json({ success: true, transactionId, xmlValid: xmlOk, response: respPayload.xml });
  } catch (err) {
    console.error('\n[TOLL ERROR][Refund send]', err.message);
    if (err.code === 'ECONNREFUSED') console.error('  Bank server nahi chal raha!');
    res.status(500).json({ error: err.message });
  }
}
