/**
 * AccountController.js — Bank ka FASTag/vehicle account lookup handler
 *
 * receiveListAccount : POST /api/list-account — Toll vehicle/FASTag account details puchta hai
 *
 * XML format real NPCI NETC "etc:ReqTagDetails" schema follow karta hai
 * (Head/Txn/Vehicle, values attributes me). Response root "RespTagDetails"
 * hai — Txn ke andar Resp, Resp ke andar Vehicle (tagId/vehicleRegNo/TID/
 * vehicleClass/tagStatus) — yeh structure real production code ke
 * normalizeRespTagDetails() se confirm kiya gaya hai.
 */

import * as PaymentService from '../services/PaymentService.js';
import * as accountStore from '../store/accountStore.js';

export async function receiveListAccount(req, res) {
  try {
    console.log('\n[BANK] ReqTagDetails received');

    const { data: decrypted, pgpSigValid } = await PaymentService.pgpDecrypt(req.body);
    const payload = JSON.parse(decrypted);
    const xmlOk = PaymentService.verifyXmlSig(payload.xml, payload.xmlSignature);
    console.log(`  [PGP sig] ${pgpSigValid ? 'VALID' : 'UNVERIFIED'}   [XML sig] ${xmlOk ? 'VALID' : 'INVALID'}`);
    if (!xmlOk) return res.status(400).send('XML signature invalid — request reject!');

    const msgId     = PaymentService.getXmlAttr(payload.xml, 'Head', 'msgId') || 'UNKNOWN';
    const vehicleId = PaymentService.getXmlAttr(payload.xml, 'Vehicle', 'vehicleRegNo');
    const account   = accountStore.lookupAccount(vehicleId);
    console.log(`  vehicleRegNo: ${vehicleId}  → ${account ? account.status : 'NOT_FOUND'}`);

    const ts = new Date().toISOString();
    const respInner = account
      ? `<Resp result="ACCEPTED" respCode="00">
      <Vehicle tagId="${account.fastagId}" vehicleRegNo="${vehicleId}" TID="" vehicleClass="${account.vehicleClass}" tagStatus="${account.status}"/>
    </Resp>`
      : `<Resp result="NOT_FOUND" respCode="404"/>`;

    const responseXml = `<RespTagDetails>
  <Head msgId="${msgId}" orgId="ABCBANK" ts="${ts}" ver="1.0"/>
  <Txn id="${msgId}">
    ${respInner}
  </Txn>
</RespTagDetails>`;

    const responseXmlSig = PaymentService.signXml(responseXml);
    const encryptedResponse = await PaymentService.pgpEncrypt({ xml: responseXml, xmlSignature: responseXmlSig });

    res.set('Content-Type', 'text/plain');
    res.send(encryptedResponse);
  } catch (err) {
    console.error('\n[BANK ERROR][TagDetails]', err.message);
    res.status(500).send(err.message);
  }
}
