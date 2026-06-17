/**
 * HeartbeatController.js — Toll ka Heartbeat handler (bidirectional)
 *
 * runHeartbeat     : real flow me background timer se chalta hai
 *                    (NetcRuntimeService), GET /api/send-heartbeat se manually bhi
 * receiveHeartbeat : POST /api/heartbeat — Bank toll ko heartbeat bhejta hai
 *
 * Dono full pipeline follow karte hain: mTLS → PGP decrypt/verify → XML sig verify
 * → process → XML sign → PGP encrypt → response
 *
 * XML format real NPCI NETC "etc:TollplazaHbeatReq" schema follow karta hai
 * (Head/Txn/HbtMsg/Plaza/Lane) — values attributes me hote hain
 */

import * as PaymentService from '../services/PaymentService.js';

// ── Send Heartbeat (Toll → Bank) — req/res se independent ─────
export async function runHeartbeat() {
  try {
    console.log('\n[TOLL] Sending heartbeat to bank');

    const msgId = `HBT-${Date.now()}`;
    const ts    = new Date().toISOString();
    const requestXml = `<etc:TollplazaHbeatReq xmlns:etc="http://npci.org/etc/schema/">
  <Head msgId="${msgId}" orgId="BHGT" ts="${ts}" ver="1.0"/>
  <Txn id="${msgId}" ts="${ts}" type="Hbt">
    <HbtMsg type="ALIVE" acquirerId="BHGT"/>
    <Plaza id="BHAGAT-TOLL-PLAZA-01" name="Bhagat Tai Laitoll Plaza" type="Toll">
      <Lane id="1" readerId="RDR-01" Status="OPEN"/>
      <Lane id="2" readerId="RDR-02" Status="OPEN"/>
    </Plaza>
  </Txn>
</etc:TollplazaHbeatReq>`;

    const xmlSignature = PaymentService.signXml(requestXml);
    const encrypted = await PaymentService.pgpEncrypt({ xml: requestXml, xmlSignature });

    const bankResponse = await PaymentService.sendToBank('/api/heartbeat', encrypted);
    const { data: decrypted, pgpSigValid } = await PaymentService.pgpDecrypt(bankResponse);
    const respPayload = JSON.parse(decrypted);
    const xmlOk = PaymentService.verifyXmlSig(respPayload.xml, respPayload.xmlSignature);

    console.log(`  [PGP sig] ${pgpSigValid ? 'VALID' : 'UNVERIFIED'}   [XML sig] ${xmlOk ? 'VALID' : 'INVALID'}`);
    console.log(respPayload.xml);

    return { success: true, msgId, xmlValid: xmlOk, response: respPayload.xml };
  } catch (err) {
    console.error('\n[TOLL ERROR][Heartbeat send]', err.message);
    if (err.code === 'ECONNREFUSED') console.error('  Bank server nahi chal raha!');
    return { success: false, error: err.message };
  }
}

// ── GET /api/send-heartbeat — manual trigger (testing ke liye) ─
export async function sendHeartbeat(req, res) {
  const result = await runHeartbeat();
  res.status(result.success ? 200 : 500).json(result);
}

// ── Receive Heartbeat (Bank → Toll) ───────────────────────────
export async function receiveHeartbeat(req, res) {
  try {
    console.log('\n[TOLL] Heartbeat received');

    const { data: decrypted, pgpSigValid } = await PaymentService.pgpDecrypt(req.body);
    const payload = JSON.parse(decrypted);
    const xmlOk = PaymentService.verifyXmlSig(payload.xml, payload.xmlSignature);
    console.log(`  [PGP sig] ${pgpSigValid ? 'VALID' : 'UNVERIFIED'}   [XML sig] ${xmlOk ? 'VALID' : 'INVALID'}`);
    if (!xmlOk) return res.status(400).send('XML signature invalid — heartbeat reject!');

    const msgId = PaymentService.getXmlAttr(payload.xml, 'Head', 'msgId') || 'UNKNOWN';
    const txnId = PaymentService.getXmlAttr(payload.xml, 'Txn', 'id') || msgId;
    console.log(`  msgId: ${msgId}  → ALIVE`);

    const ts = new Date().toISOString();
    const responseXml = `<RespHbeat>
  <Head msgId="${msgId}" orgId="BHGT" ts="${ts}" ver="1.0"/>
  <Txn id="${txnId}" ts="${ts}" type="Hbt"/>
  <Resp result="ACCEPTED" respCode="00"/>
</RespHbeat>`;

    const responseXmlSig = PaymentService.signXml(responseXml);
    const encryptedResponse = await PaymentService.pgpEncrypt({ xml: responseXml, xmlSignature: responseXmlSig });

    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (err) {
    console.error('\n[TOLL ERROR][Heartbeat]', err.message);
    res.status(500).send(err.message);
  }
}
