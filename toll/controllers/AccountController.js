/**
 * AccountController.js — Toll ka FASTag/vehicle account lookup initiator
 *
 * sendListAccount : GET /api/send-list-account?vehicle=MH12AB1234
 *
 * XML format real NPCI NETC "etc:ReqTagDetails" schema follow karta hai
 * (Head/Txn/Vehicle, values attributes me, type="FETCH")
 */

import * as PaymentService from '../services/PaymentService.js';

export async function sendListAccount(req, res) {
  try {
    const vehicleId = req.query.vehicle;
    if (!vehicleId) return res.status(400).json({ error: 'vehicle query param required' });

    console.log(`\n[TOLL] Sending ReqTagDetails for ${vehicleId}`);

    const msgId = `LST-${Date.now()}`;
    const ts    = new Date().toISOString();
    const requestXml = `<etc:ReqTagDetails xmlns:etc="http://npci.org/etc/schema/">
  <Head msgId="${msgId}" orgId="BHGT" ts="${ts}" ver="1.0"/>
  <Txn id="${msgId}" note="" ts="${ts}" type="FETCH">
    <Vehicle TID="" vehicleRegNo="${vehicleId}" tagId=""/>
  </Txn>
</etc:ReqTagDetails>`;

    const xmlSignature = PaymentService.signXml(requestXml);
    const encrypted = await PaymentService.pgpEncrypt({ xml: requestXml, xmlSignature });

    const bankResponse = await PaymentService.sendToBank('/api/list-account', encrypted);
    const { data: decrypted, pgpSigValid } = await PaymentService.pgpDecrypt(bankResponse);
    const respPayload = JSON.parse(decrypted);
    const xmlOk = PaymentService.verifyXmlSig(respPayload.xml, respPayload.xmlSignature);

    console.log(`  [PGP sig] ${pgpSigValid ? 'VALID' : 'UNVERIFIED'}   [XML sig] ${xmlOk ? 'VALID' : 'INVALID'}`);
    console.log(respPayload.xml);

    res.json({ success: true, vehicleId, xmlValid: xmlOk, response: respPayload.xml });
  } catch (err) {
    console.error('\n[TOLL ERROR][TagDetails send]', err.message);
    if (err.code === 'ECONNREFUSED') console.error('  Bank server nahi chal raha!');
    res.status(500).json({ error: err.message });
  }
}
