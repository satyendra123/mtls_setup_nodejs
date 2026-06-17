import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');   // toll/ folder

dotenv.config({ path: path.join(root, '.env') });

const config = {
  port: Number(process.env.PORT) || 9443,
  host: process.env.HOST || '0.0.0.0',
  env:  process.env.NODE_ENV || 'development',

  bank: {
    host: process.env.BANK_HOST || 'localhost',
    port: Number(process.env.BANK_PORT) || 8443,
  },

  tls: {
    serverCert: path.join(root, process.env.TLS_SERVER_CERT || 'ca/server.crt'),
    serverKey:  path.join(root, process.env.TLS_SERVER_KEY  || 'ca/server.key'),
    caCert:     path.join(root, process.env.TLS_CA_CERT     || 'ca/ca.crt'),
    clientCert: path.join(root, process.env.TLS_CLIENT_CERT || 'ca/client.crt'),
    clientKey:  path.join(root, process.env.TLS_CLIENT_KEY  || 'ca/client.key'),
  },

  signing: {
    tollSignKey:   path.join(root, process.env.TOLL_SIGN_KEY   || 'ca/toll-sign.key'),
    bankVerifyPub: path.join(root, process.env.BANK_VERIFY_PUB || 'ca/bank-verify.pub'),
  },

  pgp: {
    tollPrivate: path.join(root, process.env.TOLL_PGP_PRIVATE || 'ca/toll-pgp-private.asc'),
    bankPublic:  path.join(root, process.env.BANK_PGP_PUBLIC  || 'ca/bank-pgp-public.asc'),
    passphrase:  process.env.TOLL_PGP_PASSPHRASE || 'toll-pgp-secret-2024',
  },
};

export default config;
