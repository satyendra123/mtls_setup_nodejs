/**
 * SyncTimeController.js — Toll ka Time Sync handler (bidirectional)
 *
 * runSyncTime     : real flow me background timer se chalta hai
 *                   (NetcRuntimeService), GET /api/send-synctime se manually bhi
 * receiveSyncTime : POST /api/synctime — Bank toll se time sync karta hai
 *
 * XML format real NPCI NETC "etc:ReqSyncTime" schema follow karta hai —
 * sirf Head element hota hai, client ka timestamp Head ke "ts" attribute
 * me hi hota hai (alag se ClientTimestamp tag nahi hota)
 */

import * as PaymentService from '../services/PaymentService.js';

// ── Send SyncTime (Toll → Bank) — req/res se independent ──────
export async function runSyncTime() {
  try {
    console.log('\n[TOLL] Sending synctime request to bank');

    const msgId = `SYNC-${Date.now()}`;
    const ts    = new Date().toISOString();
    const requestXml = `<etc:ReqSyncTime xmlns:etc="http://npci.org/etc/schema/">
  <Head msgId="${msgId}" orgId="BHGT" ts="${ts}" ver="1.0"/>
</etc:ReqSyncTime>`;

    const xmlSignature = PaymentService.signXml(requestXml);
    const encrypted = await PaymentService.pgpEncrypt({ xml: requestXml, xmlSignature });

    const bankResponse = await PaymentService.sendToBank('/api/synctime', encrypted);
    const { data: decrypted, pgpSigValid } = await PaymentService.pgpDecrypt(bankResponse);
    const respPayload = JSON.parse(decrypted);
    const xmlOk = PaymentService.verifyXmlSig(respPayload.xml, respPayload.xmlSignature);

    console.log(`  [PGP sig] ${pgpSigValid ? 'VALID' : 'UNVERIFIED'}   [XML sig] ${xmlOk ? 'VALID' : 'INVALID'}`);
    console.log(respPayload.xml);

    return { success: true, msgId, xmlValid: xmlOk, response: respPayload.xml };
  } catch (err) {
    console.error('\n[TOLL ERROR][SyncTime send]', err.message);
    if (err.code === 'ECONNREFUSED') console.error('  Bank server nahi chal raha!');
    return { success: false, error: err.message };
  }
}

// ── GET /api/send-synctime — manual trigger (testing ke liye) ──
export async function sendSyncTime(req, res) {
  const result = await runSyncTime();
  res.status(result.success ? 200 : 500).json(result);
}

// ── Receive SyncTime (Bank → Toll) ────────────────────────────
export async function receiveSyncTime(req, res) {
  try {
    console.log('\n[TOLL] SyncTime request received');

    const { data: decrypted, pgpSigValid } = await PaymentService.pgpDecrypt(req.body);
    const payload = JSON.parse(decrypted);
    const xmlOk = PaymentService.verifyXmlSig(payload.xml, payload.xmlSignature);
    console.log(`  [PGP sig] ${pgpSigValid ? 'VALID' : 'UNVERIFIED'}   [XML sig] ${xmlOk ? 'VALID' : 'INVALID'}`);
    if (!xmlOk) return res.status(400).send('XML signature invalid — synctime reject!');

    const msgId           = PaymentService.getXmlAttr(payload.xml, 'Head', 'msgId') || 'UNKNOWN';
    const clientTimestamp = PaymentService.getXmlAttr(payload.xml, 'Head', 'ts');
    const serverTimestamp = new Date().toISOString();
    const driftMs         = new Date(serverTimestamp) - new Date(clientTimestamp);
    console.log(`  msgId: ${msgId}  DriftMs: ${driftMs}`);

    const responseXml = `<RespSyncTime>
  <Head msgId="${msgId}" orgId="BHGT" ts="${serverTimestamp}" ver="1.0"/>
  <Resp result="ACCEPTED" respCode="00" clientTs="${clientTimestamp}" driftMs="${driftMs}"/>
</RespSyncTime>`;

    const responseXmlSig = PaymentService.signXml(responseXml);
    const encryptedResponse = await PaymentService.pgpEncrypt({ xml: responseXml, xmlSignature: responseXmlSig });

    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (err) {
    console.error('\n[TOLL ERROR][SyncTime]', err.message);
    res.status(500).send(err.message);
  }
}
