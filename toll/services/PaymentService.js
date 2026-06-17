/**
 * PaymentService.js — Toll ki crypto operations
 *
 * Ye service 5 kaam karti hai:
 *  1. signXml()         — Payment XML ko toll ki private key se sign karo
 *  2. pgpEncrypt()      — Sign hua data bank ki public key se encrypt karo
 *  3. sendToBank()      — mTLS HTTPS request bank ko bhejo
 *  4. pgpDecrypt()      — Bank ka encrypted response decrypt karo
 *  5. verifyXmlSig()    — Bank ka XML signature verify karo
 */

import * as openpgp from 'openpgp';
import crypto       from 'crypto';
import https        from 'https';
import fs           from 'fs';
import config       from '../config/config.js';

// Keys ek baar load karo
const tollPGPPrivArmored = fs.readFileSync(config.pgp.tollPrivate,  'utf8');
const bankPGPPubArmored  = fs.readFileSync(config.pgp.bankPublic,   'utf8');
const tollSignKeyPem     = fs.readFileSync(config.signing.tollSignKey,   'utf8');
const bankVerifyPubPem   = fs.readFileSync(config.signing.bankVerifyPub, 'utf8');

// mTLS client options (jab toll bank ko request kare)
// Files: toll/ca/client.crt, toll/ca/client.key, toll/ca/ca.crt
const mtlsClientOpts = {
  cert: fs.readFileSync(config.tls.clientCert), // Toll ka client cert → bank ko bhejta hai
  key:  fs.readFileSync(config.tls.clientKey),  // Client cert prove karne ke liye
  ca:   fs.readFileSync(config.tls.caCert),     // Bank ka server cert verify karne ke liye
};

const bankPGPPubKey = await openpgp.readKey({ armoredKey: bankPGPPubArmored });

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
// Toll APNI RSA PRIVATE KEY se XML sign karta hai
// Bank TOLL KI PUBLIC KEY se verify karega
export function signXml(xml) {
  const signer = crypto.createSign('SHA256');
  signer.update(xml);
  return signer.sign(tollSignKeyPem, 'base64');
}

// ── PGP Encrypt ────────────────────────────────────────────
// BANK KI PUBLIC KEY se data lock karo
// Sirf bank apni PRIVATE KEY se unlock kar sakta hai
export async function pgpEncrypt(data) {
  const tollPrivKey = await openpgp.decryptKey({
    privateKey: await openpgp.readPrivateKey({ armoredKey: tollPGPPrivArmored }),
    passphrase: config.pgp.passphrase,
  });
  return openpgp.encrypt({
    message:        await openpgp.createMessage({ text: typeof data === 'string' ? data : JSON.stringify(data) }),
    encryptionKeys: bankPGPPubKey,  // Bank ki PUBLIC key se lock
    signingKeys:    tollPrivKey,    // Toll ki PRIVATE key se PGP sign (identity proof)
  });
}

// ── Send to Bank (mTLS HTTPS) ──────────────────────────────
// Toll bank ko mTLS request bhejta hai
// Toll apna CLIENT CERTIFICATE present karta hai
// Bank verify karta hai: "CA se signed hai?"
export function sendToBank(path, encryptedBody) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(encryptedBody, 'utf8');
    const reqOpts = {
      hostname: config.bank.host,
      port:     config.bank.port,
      path,
      method:   'POST',
      headers: {
        'Content-Type':   'text/plain',
        'Content-Length': body.length,
      },
      cert: mtlsClientOpts.cert,  // toll/ca/client.crt → bank ko bhejta hai
      key:  mtlsClientOpts.key,   // toll/ca/client.key → cert prove karne ke liye
      ca:   mtlsClientOpts.ca,    // toll/ca/ca.crt     → bank ka server cert verify
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

// ── PGP Decrypt ────────────────────────────────────────────
// Bank ne TOLL KI PUBLIC KEY se encrypt kiya tha
// Toll APNI PRIVATE KEY se decrypt karta hai
export async function pgpDecrypt(armoredMessage) {
  const tollPrivKey = await openpgp.decryptKey({
    privateKey: await openpgp.readPrivateKey({ armoredKey: tollPGPPrivArmored }),
    passphrase: config.pgp.passphrase,
  });
  const { data, signatures } = await openpgp.decrypt({
    message:          await openpgp.readMessage({ armoredMessage }),
    decryptionKeys:   tollPrivKey,
    verificationKeys: bankPGPPubKey,
  });

  let pgpSigValid = false;
  try { await signatures[0].verified; pgpSigValid = true; } catch (_) {}

  return { data, pgpSigValid };
}

// ── XML Signature Verify ───────────────────────────────────
// Bank ne BANK KI RSA PRIVATE KEY se sign kiya tha
// Toll BANK KI PUBLIC KEY se verify karta hai
export function verifyXmlSig(xml, signatureBase64) {
  const verifier = crypto.createVerify('SHA256');
  verifier.update(xml);
  return verifier.verify(bankVerifyPubPem, signatureBase64, 'base64');
}
