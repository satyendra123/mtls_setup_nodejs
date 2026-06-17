/**
 * PaymentController.js — Toll ka payment flow handler
 *
 * Routes:
 *   GET  /api/send-payment?vehicle=MH12AB1234&amount=50   — quick browser test (fake tag/tid)
 *   POST /api/fasttag/payment                              — real RFID reader / Postman se vehicle scan data
 *                                                             (real system me yehi route hai: TagController.paymentDetection)
 *
 * Steps (dono routes same pipeline use karte hain):
 *  1. XML payment request banao
 *  2. toll/ca/toll-sign.key se XML sign karo
 *  3. toll/ca/bank-pgp-public.asc se PGP encrypt karo
 *  4. mTLS ke through bank:8443 ko POST karo (toll/ca/client.crt bhejega)
 *  5. Bank ka encrypted response aaya
 *  6. toll/ca/toll-pgp-private.asc se PGP decrypt karo
 *  7. toll/ca/bank-verify.pub se XML signature verify karo
 */

import * as PaymentService from '../services/PaymentService.js';

// ── Shared pipeline: ek vehicle ka payment bank ko bhejo ──────
// XML format real NPCI NETC "etc:ReqPay" schema follow karta hai
// (Head/Txn/Plaza/Lane/Vehicle/Payment) — values attributes me hote
// hain, nested tags me nahi. Real spec me bohot zyada fields hote hain
// (WIM weight, AVC class, reader-verification crypto, etc.) — yahan
// sirf learning ke liye core skeleton rakha hai.
async function processVehiclePayment({ vehno, tagid, tid, vehicleclass, toll_fare, lane_id }) {
  const txnId = `TXN-${Date.now()}`;
  const msgId = txnId; // real NETC flows me bhi msgId == txnId hota hai
  const ts    = new Date().toISOString();

  // ── STEP 1: XML Payment Request (etc:ReqPay) ──────────
  console.log('\n  [XML] Payment request bana raha hai (etc:ReqPay)...');
  const paymentXml = `<etc:ReqPay xmlns:etc="http://npci.org/etc/schema/">
  <Head msgId="${msgId}" orgId="BHGT" ts="${ts}" ver="1.0"/>
  <Txn id="${txnId}" ts="${ts}" type="DEBIT"/>
  <Plaza id="BHAGAT-TOLL-PLAZA-01" name="Bhagat Tai Laitoll Plaza" type="Toll">
    <Lane id="${lane_id}" readerId="RDR-01" direction="S" Status="OPEN"/>
  </Plaza>
  <Vehicle TID="${tid}" tagId="${tagid}" vehicleRegNo="${vehno}" vehicleClass="${vehicleclass}"/>
  <Payment>
    <Amount curr="INR" value="${toll_fare}"/>
  </Payment>
</etc:ReqPay>`;
  console.log(paymentXml);

  // ── STEP 2: XML Sign ──────────────────────────────────
  console.log('\n  [XML Sig] Sign kar raha hai (toll/ca/toll-sign.key)...');
  const xmlSignature = PaymentService.signXml(paymentXml);
  console.log('    ✓ XML signed (RSA-SHA256)');

  // ── STEP 3: PGP Encrypt ───────────────────────────────
  console.log('\n  [PGP] Encrypt kar raha hai (toll/ca/bank-pgp-public.asc)...');
  const encrypted = await PaymentService.pgpEncrypt({ transactionId: txnId, xml: paymentXml, xmlSignature });
  console.log('    ✓ PGP encrypted (+ Toll PGP signature andar)');

  // ── STEP 4: mTLS Request bank ko ─────────────────────
  console.log('\n  [mTLS] Bank:8443 ko request bhej raha hai...');
  console.log('    toll/ca/client.crt → bank ko present karega');
  const bankResponse = await PaymentService.sendToBank('/api/payment', encrypted);
  console.log('    ✓ Bank se encrypted response mila');

  // ── STEP 5: PGP Decrypt ───────────────────────────────
  console.log('\n  [PGP] Bank ka response decrypt kar raha hai (toll/ca/toll-pgp-private.asc)...');
  const { data: decrypted, pgpSigValid } = await PaymentService.pgpDecrypt(bankResponse);
  console.log(`    ✓ PGP Decrypt: SUCCESS`);
  console.log(`    ✓ Bank PGP Signature: ${pgpSigValid ? 'VALID' : 'UNVERIFIED'}`);

  // ── STEP 6: XML Sig Verify ────────────────────────────
  const respPayload = JSON.parse(decrypted);
  console.log('\n  [XML Sig] Bank ka response verify kar raha hai (toll/ca/bank-verify.pub)...');
  const xmlOk = PaymentService.verifyXmlSig(respPayload.xml, respPayload.xmlSignature);
  console.log(`    ✓ XML Signature: ${xmlOk ? 'VALID' : 'INVALID'}`);

  console.log('\n  [Result] Bank Response XML:');
  console.log(respPayload.xml);

  return { txnId, xmlOk, respPayload };
}

// ── Lane decision — bank ke RespPay result se barrier/cash-fallback
// decide karo. Real TagController.buildPaymentDecision() ka simplified
// version (waha pending/manual_review jaise extra states bhi hote hain).
function buildPaymentDecision(responseXml) {
  const result = PaymentService.getXmlAttr(responseXml, 'Resp', 'result');

  if (result === 'ACCEPTED' || result === 'REFUNDED') {
    return {
      action: 'open_barrier',
      barrier_command: 'open',
      traffic_light: 'green',
      display_message: 'FASTAG PAYMENT SUCCESS',
      allow_cash: false,
      allow_upi: false,
    };
  }

  return {
    action: 'switch_to_cash_or_upi',
    barrier_command: 'hold',
    traffic_light: 'red',
    display_message: 'FASTAG PAYMENT FAILED - TAKE CASH OR UPI',
    allow_cash: true,
    allow_upi: true,
  };
}

// ── GET /api/send-payment — quick browser test (fake tag/tid) ─
export async function sendPayment(req, res) {
  try {
    console.log('\n▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
    console.log('  TOLL: Payment bhej raha hai bank ko (quick test, fake tag/tid)');
    console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');

    const vehno      = req.query.vehicle || 'MH12AB1234';
    const toll_fare  = req.query.amount  || '50.00';

    const { txnId, xmlOk, respPayload } = await processVehiclePayment({
      vehno, tagid: 'SIMULATED-TAGID', tid: 'SIMULATED-TID',
      vehicleclass: '4', toll_fare, lane_id: 'LANE-03',
    });

    res.json({
      success: true, transactionId: txnId, vehicle: vehno,
      amount: toll_fare, bankResponse: respPayload.xml, xmlValid: xmlOk,
    });

  } catch (err) {
    console.error('\n[TOLL ERROR]', err.message);
    if (err.code === 'ECONNREFUSED') console.error('  Bank server nahi chal raha! npm start karo bank me.');
    res.status(500).json({ error: err.message });
  }
}

// ── POST /api/fasttag/payment — real RFID reader / Postman ────
// Body (JSON), real system jaisa field naming:
//   { "tagid": "...", "tid": "...", "vehno": "MH12AB1234",
//     "vehicleclass": "4", "toll_fare": "50.00", "lane_id": "LANE-03" }
export async function vehicleEntry(req, res) {
  try {
    console.log('\n▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');
    console.log('  TOLL: Vehicle entry — RFID scan data aaya');
    console.log('▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓');

    const body = JSON.parse(req.body);
    const { tagid, tid, vehno } = body;
    if (!vehno || !tagid || !tid) {
      return res.status(400).json({ error: 'vehno, tagid, tid required' });
    }
    console.log(`  vehno: ${vehno}  tagid: ${tagid}  tid: ${tid}`);

    const { txnId, xmlOk, respPayload } = await processVehiclePayment({
      vehno,
      tagid,
      tid,
      vehicleclass: body.vehicleclass || '4',
      toll_fare:    body.toll_fare    || '50.00',
      lane_id:      body.lane_id      || 'LANE-01',
    });

    const decision = buildPaymentDecision(respPayload.xml);
    console.log(`  [Decision] ${decision.action}  (${decision.display_message})`);

    res.json({
      success: true, transactionId: txnId, vehno, tagid, tid,
      bankResponse: respPayload.xml, xmlValid: xmlOk, decision,
    });

  } catch (err) {
    console.error('\n[TOLL ERROR][vehicle-entry]', err.message);
    if (err.code === 'ECONNREFUSED') console.error('  Bank server nahi chal raha! npm start karo bank me.');
    res.status(500).json({ error: err.message });
  }
}

export function healthCheck(req, res) {
  res.json({ server: 'Bhagat Toll', port: 9443, status: 'running' });
}
