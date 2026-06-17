import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');   // bank/ folder

// Explicit path — taaki kisi bhi directory se run karo, sahi .env load ho
dotenv.config({ path: path.join(root, '.env') });

const config = {
  port: Number(process.env.PORT) || 8443,
  host: process.env.HOST || '0.0.0.0',
  env:  process.env.NODE_ENV || 'development',

  toll: {
    host: process.env.TOLL_HOST || 'localhost',
    port: Number(process.env.TOLL_PORT) || 9443,
  },

  tls: {
    serverCert:  path.join(root, process.env.TLS_SERVER_CERT || 'ca/server.crt'),
    serverKey:   path.join(root, process.env.TLS_SERVER_KEY  || 'ca/server.key'),
    caCert:      path.join(root, process.env.TLS_CA_CERT     || 'ca/ca.crt'),
    clientCert:  path.join(root, process.env.TLS_CLIENT_CERT || 'ca/client.crt'),
    clientKey:   path.join(root, process.env.TLS_CLIENT_KEY  || 'ca/client.key'),
  },

  signing: {
    bankSignKey:   path.join(root, process.env.BANK_SIGN_KEY   || 'ca/bank-sign.key'),
    tollVerifyPub: path.join(root, process.env.TOLL_VERIFY_PUB || 'ca/toll-verify.pub'),
  },

  pgp: {
    bankPrivate:   path.join(root, process.env.BANK_PGP_PRIVATE || 'ca/bank-pgp-private.asc'),
    tollPublic:    path.join(root, process.env.TOLL_PGP_PUBLIC  || 'ca/toll-pgp-public.asc'),
    passphrase:    process.env.BANK_PGP_PASSPHRASE || 'bank-pgp-secret-2024',
  },
};

export default config;
