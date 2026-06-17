/**
 * HeartbeatController.js — Bank ka Heartbeat handler (bidirectional)
 *
 * receiveHeartbeat : POST /api/heartbeat — Toll bank ko heartbeat bhejta hai
 * runHeartbeat     : real flow me background timer se chalta hai
 *                    (NetcRuntimeService), GET /api/send-heartbeat se manually bhi
 *
 * Dono full pipeline follow karte hain: mTLS → PGP decrypt/verify → XML sig verify
 * → process → XML sign → PGP encrypt → response
 *
 * XML format real NPCI NETC "etc:TollplazaHbeatReq" schema follow karta hai
 * (Head/Txn/HbtMsg/Plaza/Lane) — values attributes me hote hain
 */

import * as PaymentService from '../services/PaymentService.js';

// ── Receive Heartbeat (Toll → Bank) ───────────────────────────
export async function receiveHeartbeat(req, res) {
  try {
    console.log('\n[BANK] Heartbeat received');

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
  <Head msgId="${msgId}" orgId="ABCBANK" ts="${ts}" ver="1.0"/>
  <Txn id="${txnId}" ts="${ts}" type="Hbt"/>
  <Resp result="ACCEPTED" respCode="00"/>
</RespHbeat>`;

    const responseXmlSig = PaymentService.signXml(responseXml);
    const encryptedResponse = await PaymentService.pgpEncrypt({ xml: responseXml, xmlSignature: responseXmlSig });

    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (err) {
    console.error('\n[BANK ERROR][Heartbeat]', err.message);
    res.status(500).send(err.message);
  }
}

// ── Send Heartbeat (Bank → Toll) — req/res se independent ─────
export async function runHeartbeat() {
  try {
    console.log('\n[BANK] Sending heartbeat to toll');

    const msgId = `HBT-${Date.now()}`;
    const ts    = new Date().toISOString();
    const requestXml = `<etc:TollplazaHbeatReq xmlns:etc="http://npci.org/etc/schema/">
  <Head msgId="${msgId}" orgId="ABCBANK" ts="${ts}" ver="1.0"/>
  <Txn id="${msgId}" ts="${ts}" type="Hbt">
    <HbtMsg type="ALIVE" acquirerId="ABCBANK"/>
    <Plaza id="ABC-BANK-HQ" name="ABC Bank" type="Issuer">
      <Lane id="1" readerId="N/A" Status="OPEN"/>
    </Plaza>
  </Txn>
</etc:TollplazaHbeatReq>`;

    const xmlSignature = PaymentService.signXml(requestXml);
    const encrypted = await PaymentService.pgpEncrypt({ xml: requestXml, xmlSignature });

    const tollResponse = await PaymentService.sendToToll('/api/heartbeat', encrypted);
    const { data: decrypted, pgpSigValid } = await PaymentService.pgpDecrypt(tollResponse);
    const respPayload = JSON.parse(decrypted);
    const xmlOk = PaymentService.verifyXmlSig(respPayload.xml, respPayload.xmlSignature);

    console.log(`  [PGP sig] ${pgpSigValid ? 'VALID' : 'UNVERIFIED'}   [XML sig] ${xmlOk ? 'VALID' : 'INVALID'}`);
    console.log(respPayload.xml);

    return { success: true, msgId, xmlValid: xmlOk, response: respPayload.xml };
  } catch (err) {
    console.error('\n[BANK ERROR][Heartbeat send]', err.message);
    if (err.code === 'ECONNREFUSED') console.error('  Toll server nahi chal raha!');
    return { success: false, error: err.message };
  }
}

// ── GET /api/send-heartbeat — manual trigger (testing ke liye) ─
export async function sendHeartbeat(req, res) {
  const result = await runHeartbeat();
  res.status(result.success ? 200 : 500).json(result);
}
