/**
 * PaymentService.js — Bank ki crypto operations
 *
 * Ye service 4 kaam karti hai:
 *  1. pgpDecrypt()      — Toll ka encrypted data decrypt karo
 *  2. verifyXmlSig()    — Toll ka XML signature verify karo
 *  3. signXml()         — Response XML ko bank ki private key se sign karo
 *  4. pgpEncrypt()      — Response ko toll ki public key se encrypt karo
 */

import * as openpgp from 'openpgp';
import crypto       from 'crypto';
import https        from 'https';
import fs           from 'fs';
import config       from '../config/config.js';

// Keys ek baar load karo (server start pe)
const bankPGPPrivArmored  = fs.readFileSync(config.pgp.bankPrivate,   'utf8');
const tollPGPPubArmored   = fs.readFileSync(config.pgp.tollPublic,    'utf8');
const bankSignKeyPem      = fs.readFileSync(config.signing.bankSignKey,   'utf8');
const tollVerifyPubPem    = fs.readFileSync(config.signing.tollVerifyPub, 'utf8');

// Pre-load PGP public key (reuse karo har request pe)
const tollPGPPubKey = await openpgp.readKey({ armoredKey: tollPGPPubArmored });

// mTLS client options (jab bank toll ko request kare — heartbeat/synctime)
// Files: bank/ca/client.crt, bank/ca/client.key, bank/ca/ca.crt
const mtlsClientOpts = {
  cert: fs.readFileSync(config.tls.clientCert), // Bank ka client cert → toll ko bhejta hai
  key:  fs.readFileSync(config.tls.clientKey),
  ca:   fs.readFileSync(config.tls.caCert),     // Toll ka server cert verify karne ke liye
};

// ── PGP Decrypt ────────────────────────────────────────────
// Toll ne bank ki PUBLIC key se encrypt kiya tha
// Bank apni PRIVATE key se decrypt karta hai
export async function pgpDecrypt(armoredMessage) {
  const bankPrivKey = await openpgp.decryptKey({
    privateKey: await openpgp.readPrivateKey({ armoredKey: bankPGPPrivArmored }),
    passphrase: config.pgp.passphrase,
  });
  const message = await openpgp.readMessage({ armoredMessage });
  const { data, signatures } = await openpgp.decrypt({
    message,
    decryptionKeys:   bankPrivKey,
    verificationKeys: tollPGPPubKey, // Toll ka PGP signature bhi verify
  });

  let pgpSigValid = false;
  try {
    await signatures[0].verified;
    pgpSigValid = true;
  } catch (_) {}

  return { data, pgpSigValid };
}

// ── XML Signature Verify ───────────────────────────────────
// Toll ne XML ko TOLL KI RSA PRIVATE KEY se sign kiya tha
// Bank TOLL KI PUBLIC KEY se verify karta hai
export function verifyXmlSig(xml, signatureBase64) {
  const verifier = crypto.createVerify('SHA256');
  verifier.update(xml);
  return verifier.verify(tollVerifyPubPem, signatureBase64, 'base64');
}

// ── XML Attribute Extract ───────────────────────────────────
// Real NPCI NETC schema me values tags ke andar nahi, XML attributes
// me hote hain (e.g. <Head msgId="..." ts="..."/>) — isse extract karo
export function getXmlAttr(xml, tag, attr) {
  const tagMatch = xml.match(new RegExp(`<${tag}\\b[^>]*>`));
  if (!tagMatch) return null;
  const attrMatch = tagMatch[0].match(new RegExp(`${attr}="([^"]*)"`));
  return attrMatch ? attrMatch[1] : null;
}

// ── XML Sign ───────────────────────────────────────────────
// Bank apne response XML ko BANK KI RSA PRIVATE KEY se sign karta hai
export function signXml(xml) {
  const signer = crypto.createSign('SHA256');
  signer.update(xml);
  return signer.sign(bankSignKeyPem, 'base64');
}

// ── PGP Encrypt ────────────────────────────────────────────
// Bank response ko TOLL KI PUBLIC KEY se encrypt karta hai
// Sirf toll apni PRIVATE KEY se decrypt kar payega
export async function pgpEncrypt(data) {
  const bankPrivKey = await openpgp.decryptKey({
    privateKey: await openpgp.readPrivateKey({ armoredKey: bankPGPPrivArmored }),
    passphrase: config.pgp.passphrase,
  });
  return openpgp.encrypt({
    message:        await openpgp.createMessage({ text: typeof data === 'string' ? data : JSON.stringify(data) }),
    encryptionKeys: tollPGPPubKey,   // Toll ki PUBLIC key se lock
    signingKeys:    bankPrivKey,     // Bank ki PRIVATE key se PGP sign
  });
}

// ── Send to Toll (mTLS HTTPS) ──────────────────────────────
// Bank toll ko mTLS request bhejta hai (heartbeat / synctime)
// Bank apna CLIENT CERTIFICATE present karta hai
// Toll verify karta hai: "CA se signed hai?"
export function sendToToll(path, encryptedBody) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(encryptedBody, 'utf8');
    const reqOpts = {
      hostname: config.toll.host,
      port:     config.toll.port,
      path,
      method:   'POST',
      headers: {
        'Content-Type':   'text/plain',
        'Content-Length': body.length,
      },
      cert: mtlsClientOpts.cert,  // bank/ca/client.crt → toll ko bhejta hai
      key:  mtlsClientOpts.key,
      ca:   mtlsClientOpts.ca,    // bank/ca/ca.crt → toll ka server cert verify
    };
    const r = https.request(reqOpts, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => resolve(data));
    });
    r.on('error', reject);
    r.write(body);
    r.end();
  });
}
