/**
 * TxnController.js — Bank ka transaction query/refund handler
 *
 * receiveChkTxn : POST /api/check-txn — Toll purani transaction ka status puchta hai
 * receiveRefund : POST /api/refund    — Toll transaction reverse/refund karne ko bolta hai
 *
 * Dono transactionStore (ReqPay ke time save hua data) lookup karte hain
 *
 * ReqChkTxn/ResChkTxn real NPCI NETC "etc:ReqChkTxn" schema follow karta hai
 * (Head/Txn/Ref, values attributes me). ReqRefund NPCI ka official message
 * type nahi hai (real NETC spec me per-txn refund request nahi milta) —
 * isliye sirf consistency ke liye wahi Head/Txn/Resp attribute style use
 * kiya hai, bina etc: namespace ke (taaki real NPCI element na lage).
 */

import * as PaymentService from '../services/PaymentService.js';
import * as transactionStore from '../store/transactionStore.js';

// ── Receive ReqChkTxn ──────────────────────────────────────
export async function receiveChkTxn(req, res) {
  try {
    console.log('\n[BANK] ReqChkTxn received');

    const { data: decrypted, pgpSigValid } = await PaymentService.pgpDecrypt(req.body);
    const payload = JSON.parse(decrypted);
    const xmlOk = PaymentService.verifyXmlSig(payload.xml, payload.xmlSignature);
    console.log(`  [PGP sig] ${pgpSigValid ? 'VALID' : 'UNVERIFIED'}   [XML sig] ${xmlOk ? 'VALID' : 'INVALID'}`);
    if (!xmlOk) return res.status(400).send('XML signature invalid — request reject!');

    const msgId         = PaymentService.getXmlAttr(payload.xml, 'Head', 'msgId') || 'UNKNOWN';
    const transactionId = PaymentService.getXmlAttr(payload.xml, 'Txn', 'orgTxnId');
    const txn = transactionStore.getTransaction(transactionId);

    let result, respCode;
    if (!txn)                       { result = 'NOT_FOUND'; respCode = '404'; }
    else if (txn.status === 'REFUNDED') { result = 'REFUNDED'; respCode = '00'; }
    else                             { result = 'ACCEPTED'; respCode = '00'; }
    console.log(`  orgTxnId: ${transactionId}  → ${result}`);

    const ts = new Date().toISOString();
    const responseXml = `<ResChkTxn>
  <Head msgId="${msgId}" orgId="ABCBANK" ts="${ts}" ver="1.0"/>
  <Txn id="${msgId}" orgTxnId="${transactionId}" ts="${ts}" type="Query"/>
  <Resp result="${result}" respCode="${respCode}" approvalNum="${txn?.authCode || ''}"/>
</ResChkTxn>`;

    const responseXmlSig = PaymentService.signXml(responseXml);
    const encryptedResponse = await PaymentService.pgpEncrypt({ xml: responseXml, xmlSignature: responseXmlSig });

    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (err) {
    console.error('\n[BANK ERROR][ChkTxn]', err.message);
    res.status(500).send(err.message);
  }
}

// ── Receive ReqRefund ──────────────────────────────────────
export async function receiveRefund(req, res) {
  try {
    console.log('\n[BANK] ReqRefund received');

    const { data: decrypted, pgpSigValid } = await PaymentService.pgpDecrypt(req.body);
    const payload = JSON.parse(decrypted);
    const xmlOk = PaymentService.verifyXmlSig(payload.xml, payload.xmlSignature);
    console.log(`  [PGP sig] ${pgpSigValid ? 'VALID' : 'UNVERIFIED'}   [XML sig] ${xmlOk ? 'VALID' : 'INVALID'}`);
    if (!xmlOk) return res.status(400).send('XML signature invalid — request reject!');

    const msgId         = PaymentService.getXmlAttr(payload.xml, 'Head', 'msgId') || 'UNKNOWN';
    const transactionId = PaymentService.getXmlAttr(payload.xml, 'Txn', 'orgTxnId');
    const txn = transactionStore.getTransaction(transactionId);

    let result, respCode, refundRef = '';
    if (!txn) {
      result = 'NOT_FOUND'; respCode = '404';
    } else if (txn.status === 'REFUNDED') {
      result = 'ALREADY_REFUNDED'; respCode = '00'; refundRef = txn.refundRef;
    } else {
      refundRef = 'REFUND-' + Math.random().toString(36).slice(2, 10).toUpperCase();
      transactionStore.markRefunded(transactionId, refundRef);
      result = 'ACCEPTED'; respCode = '00';
    }
    console.log(`  orgTxnId: ${transactionId}  → ${result}`);

    const ts = new Date().toISOString();
    const responseXml = `<RespRefund>
  <Head msgId="${msgId}" orgId="ABCBANK" ts="${ts}" ver="1.0"/>
  <Txn id="${msgId}" orgTxnId="${transactionId}" ts="${ts}" type="Reversal"/>
  <Resp result="${result}" respCode="${respCode}" refundRef="${refundRef}"/>
</RespRefund>`;

    const responseXmlSig = PaymentService.signXml(responseXml);
    const encryptedResponse = await PaymentService.pgpEncrypt({ xml: responseXml, xmlSignature: responseXmlSig });

    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (err) {
    console.error('\n[BANK ERROR][Refund]', err.message);
    res.status(500).send(err.message);
  }
}
