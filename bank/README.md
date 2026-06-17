# ABC Bank — mTLS + PGP + NPCI NETC Learning Server

Yeh "ABC Bank" ek **mock acquirer/issuer-side server** hai jo `https://localhost:8443` par chalta hai. Yeh real-world FASTag/NETC toll-bank integration (NPCI NETC) ka simplified, learning-purpose clone hai — `toll/` folder wala "Bhagat Toll Plaza" server isko payment/heartbeat/synctime/tag-lookup requests bhejta hai.

> Koi bhi cert/key/PGP key isme **real nahi hai** — sab self-generated, sirf is repo ke liye. Isi tarah XML schema NPCI ke publicly-documented NETC spec se inspired hai, lekin real production endpoints/keys se koi connection nahi.

## Architecture — 3 security layers ek dusre ke upar

```
Toll                                            Bank
 |  1. XML banao (etc:ReqPay jaisa)               |
 |  2. XML ko RSA-SHA256 se sign karo              |
 |  3. {xml, signature} ko PGP se encrypt karo     |
 |  4. mTLS HTTPS POST (client cert present karo) >|
 |                                                  | 5. mTLS: server peer cert verify (CA se)
 |                                                  | 6. PGP decrypt + PGP signature verify
 |                                                  | 7. XML signature verify (RSA-SHA256)
 |                                                  | 8. Process + response XML banao
 |                                                  | 9. Response sign + PGP encrypt
 | < ---------------------------------------------  | 10. Response bhejo
 | 11. PGP decrypt + XML sig verify                 |
```

| Layer | Kya karta hai | Kis se | File |
|---|---|---|---|
| **mTLS** (transport) | Dono taraf ek dusre ka TLS certificate verify karte hain — sirf CA-signed cert wala client/server connect kar sakta hai | `requestCert: true, rejectUnauthorized: true` (Node `https` server options) | `ca/server.crt`, `ca/server.key`, `ca/client.crt`, `ca/client.key`, `ca/ca.crt` |
| **XML Digital Signature** (integrity + non-repudiation) | Payload XML ko sender apni RSA private key se sign karta hai; receiver sender ki RSA public key se verify karta hai — tamper hua to signature fail ho jata hai | Node `crypto.createSign('SHA256')` / `crypto.createVerify('SHA256')` | `ca/bank-sign.key` (sign), `ca/toll-verify.pub` (verify) |
| **PGP Encryption** (confidentiality + sender-id) | `{xml, xmlSignature}` JSON ko receiver ki PGP public key se encrypt karo, apni PGP private key se PGP-sign karo | `openpgp` npm package | `ca/bank-pgp-private.asc` (decrypt), `ca/toll-pgp-public.asc` (encrypt+verify) |

Teeno independent hain — mTLS sirf "kaun connect kar raha hai" check karta hai (network layer), XML signature "data tamper nahi hua" check karta hai (application layer), PGP "sirf intended receiver hi padh sakta hai" ensure karta hai (message layer).

## Message types (NPCI NETC schema)

Real NPCI NETC integration spec (`http://npci.org/etc/schema/` namespace) follow karte hain — values **XML attributes** me hote hain, nested tags me nahi (`<Head msgId="..." ts="..."/>`, tags nahi `<MessageId>...</MessageId>`).

| Message | Route (bank side) | Direction | Schema | Real NPCI? |
|---|---|---|---|---|
| **ReqPay / RespPay** | `POST /api/payment` | Toll → Bank | `etc:ReqPay` request, `RespPay` response | ✅ Real schema |
| **Heartbeat** | `POST /api/heartbeat` (receive), `GET /api/send-heartbeat` (bank → toll) | Bidirectional | `etc:TollplazaHbeatReq` / `RespHbeat` | ✅ Real schema |
| **SyncTime** | `POST /api/synctime` (receive), `GET /api/send-synctime` (bank → toll) | Bidirectional | `etc:ReqSyncTime` / `RespSyncTime` | ✅ Real schema |
| **ReqChkTxn** | `POST /api/check-txn` | Toll → Bank | `etc:ReqChkTxn` / `ResChkTxn` | ✅ Real schema |
| **ReqRefund** | `POST /api/refund` | Toll → Bank | `ReqRefund` / `RespRefund` (Head/Txn/Resp style) | ⚠️ **Real NPCI me yeh message type nahi milta** — refunds NETC me settlement/dispute process se hote hain, per-txn API call se nahi. Sirf consistency ke liye same attribute-style rakha hai (bina `etc:` namespace ke) |
| **ReqTagDetails** | `POST /api/list-account` | Toll → Bank | `etc:ReqTagDetails` / `RespTagDetails` | ✅ Real schema |

**Important simplification:** Real NETC me bank turant HTTP response me result nahi deta — sirf ACK deta hai, asli result baad me ek **alag async callback** (`/callback/responsepay` jaisa) se aata hai, aur toll ek pending-transaction store + retry timer rakhta hai. Yeh demo **synchronous** hai (same HTTP response me sab result aa jata hai) — simplicity ke liye yeh trade-off liya gaya hai.

## In-memory data stores (sirf demo)

`store/transactionStore.js` aur `store/accountStore.js` — dono plain in-memory `Map` hain, **koi real database nahi**:

- `transactionStore` — har successful `ReqPay` yahan save hota hai (`authCode`, `bankRef`, `status`). `ReqChkTxn`/`ReqRefund` isi se lookup karte hain.
- `accountStore` — 3 hardcoded mock vehicle/FASTag accounts (`MH12AB1234` ACTIVE, `DL01CD5678` ACTIVE, `KA05XY9999` BLACKLISTED). `ReqTagDetails` isi se lookup karta hai.

Server restart pe dono khali ho jaate hain — isliye `ReqChkTxn`/`ReqRefund` sirf usi run ke andar kiye gaye `ReqPay` ke liye kaam karenge.

## Background scheduler (Heartbeat / SyncTime)

Real NETC me Heartbeat/SyncTime kabhi manual call se nahi chalte — server start hote hi ek background scheduler (`NetcRuntimeService`) automatically chalu ho jata hai:

- Startup pe turant ek baar fire (immediate)
- Fir fixed interval pe repeat

```bash
# .env me override kar sakte ho (real prod defaults bhi yahi hain):
NETC_HEARTBEAT_INTERVAL_SEC=300     # demo default: 30
NETC_TIME_SYNC_INTERVAL_SEC=14400   # demo default: 300
```

File: `services/NetcRuntimeService.js` — `app.js` me server `.listen()` ke andar `NetcRuntimeService.start()` call hota hai.

## Endpoints

```
POST /api/payment        — ReqPay receive (toll se)
POST /api/check-txn      — ReqChkTxn receive
POST /api/refund         — ReqRefund receive
POST /api/list-account   — ReqTagDetails receive
POST /api/heartbeat      — Heartbeat receive (toll se)
POST /api/synctime       — SyncTime receive (toll se)
GET  /api/send-heartbeat — Bank → Toll heartbeat manually trigger (testing)
GET  /api/send-synctime  — Bank → Toll synctime manually trigger (testing)
GET  /health              — status check
```

## Setup aur run

```bash
npm install
npm start        # node app.js
npm run dev       # nodemon app.js (auto-restart)
```

`.env` file env vars (`config/config.js` `path.join(root, '.env')` se load karta hai):

```
PORT=8443
HOST=0.0.0.0
TOLL_HOST=localhost
TOLL_PORT=9443

TLS_SERVER_CERT=ca/server.crt
TLS_SERVER_KEY=ca/server.key
TLS_CA_CERT=ca/ca.crt
TLS_CLIENT_CERT=ca/client.crt     # bank → toll calls ke liye (heartbeat/synctime)
TLS_CLIENT_KEY=ca/client.key

BANK_SIGN_KEY=ca/bank-sign.key
TOLL_VERIFY_PUB=ca/toll-verify.pub

BANK_PGP_PRIVATE=ca/bank-pgp-private.asc
TOLL_PGP_PUBLIC=ca/toll-pgp-public.asc
BANK_PGP_PASSPHRASE=bank-pgp-secret-2024
```

## `ca/` folder — file-by-file

| File | Kya hai | Kahan use hota hai |
|---|---|---|
| `ca.crt` | Shared Root CA ka certificate (bank aur toll dono ke server/client cert isi se signed hain) | TLS server `ca` option — toll ka cert verify karne ke liye |
| `server.crt` / `server.key` | Bank ke HTTPS server ka apna cert+key (CN=`bank.mtls.local`) | `https.createServer()` me `cert`/`key` |
| `client.crt` / `client.key` | Bank ka **client identity** (CN=`bank-client`) — jab bank khud toll ko call karta hai (heartbeat/synctime) | `services/PaymentService.js` ka `sendToToll()` mTLS client options |
| `bank-sign.key` | Bank ki RSA private key — apna outgoing XML sign karne ke liye | `signXml()` |
| `public.pem` | `bank-sign.key` ka public counterpart — **yeh hi file toll ko `toll/ca/bank-verify.pub` ke naam se di jaati hai** | Reference/distribution copy — app ise directly use nahi karta |
| `toll-verify.pub` | Toll ke `toll-sign.key` ka public key (toll ne diya) — toll ka XML signature verify karne ke liye | `verifyXmlSig()` |
| `bank-pgp-private.asc` | Bank ki PGP private key (armored) — incoming PGP messages decrypt karne ke liye, passphrase `.env` me | `pgpDecrypt()` / `pgpEncrypt()` (signing) |
| `toll-pgp-public.asc` | Toll ki PGP public key (toll ne diya) — toll ko encrypt karne ke liye + toll ka PGP signature verify karne ke liye | `pgpEncrypt()` / `pgpDecrypt()` (verify) |

**Key distribution model:** har side apni `*-sign.key` (RSA private) aur PGP private key khud ke paas rakhta hai, kabhi share nahi karta. Sirf **public** counterparts (`public.pem` → renamed to `<side>-verify.pub`, aur `*-pgp-public.asc`) doosre side ko diye jaate hain.

## OpenSSL/GPG se sab kuch scratch se generate karna

Niche ek complete script hai jo CA + bank + toll dono ke saare certs/keys ek baar me banata hai (kyunki ek hi CA dono ko sign karta hai). Isi machine pe ek temp folder me chalao, fir files ko `bank/ca/` aur `toll/ca/` me copy kar do jaisa neeche bataya hai.

### 1. Root CA (mTLS ke liye)

```bash
mkdir ca-build && cd ca-build

openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -subj "/CN=MTLSLearning Root CA/O=MTLS Education Lab/C=IN" \
  -out ca.crt
```

- `ca.key` — CA ki private key. **Kabhi kisi project folder me copy nahi karna** (sirf certs sign karne ke liye use hota hai, runtime pe app ko iski zaroorat nahi).
- `ca.crt` — yeh file **dono** `bank/ca/` aur `toll/ca/` me jaati hai (same file, kyunki dono isi CA ko trust karte hain).

### 2. Bank ka server certificate (mTLS server identity)

```bash
openssl genrsa -out bank-server.key 2048
openssl req -new -key bank-server.key \
  -subj "/CN=bank.mtls.local/O=ABC Bank Ltd/C=IN" \
  -out bank-server.csr

openssl x509 -req -in bank-server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 1825 -sha256 \
  -extfile <(printf "subjectAltName=DNS:localhost,DNS:bank.mtls.local,IP:127.0.0.1") \
  -out bank-server.crt
```

`subjectAltName` (SAN) zaroori hai — Node TLS client `localhost` se connect karta hai, isliye SAN list me `DNS:localhost` aur `IP:127.0.0.1` dono honi chahiye, warna hostname-mismatch error aayega.

### 3. Bank ka client certificate (jab bank khud toll ko call kare)

```bash
openssl genrsa -out bank-client.key 2048
openssl req -new -key bank-client.key \
  -subj "/CN=bank-client/O=ABC Bank Ltd/C=IN" \
  -out bank-client.csr

openssl x509 -req -in bank-client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 1825 -sha256 -out bank-client.crt
```

Client cert me SAN ki zaroorat nahi (browser/server jaisa hostname-check client cert pe nahi hota, sirf CA-chain validate hoti hai).

### 4. Toll ka server + client certificate (same pattern)

```bash
openssl genrsa -out toll-server.key 2048
openssl req -new -key toll-server.key \
  -subj "/CN=toll.mtls.local/O=Bhagat Toll Plaza/C=IN" \
  -out toll-server.csr
openssl x509 -req -in toll-server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 1825 -sha256 \
  -extfile <(printf "subjectAltName=DNS:localhost,DNS:toll.mtls.local,IP:127.0.0.1") \
  -out toll-server.crt

openssl genrsa -out toll-client.key 2048
openssl req -new -key toll-client.key \
  -subj "/CN=toll-client/O=Bhagat Toll Plaza/C=IN" \
  -out toll-client.csr
openssl x509 -req -in toll-client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 1825 -sha256 -out toll-client.crt
```

### 5. XML-signing RSA keypairs (yeh certificates NAHI hain — sirf raw RSA keys)

XML digital signature ke liye CA-signed certificate ki zaroorat nahi, sirf ek RSA keypair chahiye (jaisa JWT RS256 me hota hai):

```bash
openssl genrsa -out bank-sign.key 2048
openssl rsa -in bank-sign.key -pubout -out bank-public.pem

openssl genrsa -out toll-sign.key 2048
openssl rsa -in toll-sign.key -pubout -out toll-public.pem
```

### 6. PGP keypairs (GPG CLI se)

```bash
gpg --batch --passphrase "bank-pgp-secret-2024" --quick-generate-key \
  "ABC Bank <bank@mtls.local>" rsa3072 encrypt,sign 2y
gpg --armor --export bank@mtls.local > bank-pgp-public.asc
gpg --pinentry-mode loopback --passphrase "bank-pgp-secret-2024" \
  --armor --export-secret-keys bank@mtls.local > bank-pgp-private.asc

gpg --batch --passphrase "toll-pgp-secret-2024" --quick-generate-key \
  "Bhagat Toll Plaza <toll@mtls.local>" rsa3072 encrypt,sign 2y
gpg --armor --export toll@mtls.local > toll-pgp-public.asc
gpg --pinentry-mode loopback --passphrase "toll-pgp-secret-2024" \
  --armor --export-secret-keys toll@mtls.local > toll-pgp-private.asc
```

### 7. Files ko sahi jagah copy karo

```bash
# bank/ca/
cp ca.crt                bank/ca/ca.crt
cp bank-server.crt       bank/ca/server.crt
cp bank-server.key       bank/ca/server.key
cp bank-client.crt       bank/ca/client.crt
cp bank-client.key       bank/ca/client.key
cp bank-sign.key         bank/ca/bank-sign.key
cp bank-public.pem       bank/ca/public.pem
cp toll-public.pem       bank/ca/toll-verify.pub      # toll ki public key
cp bank-pgp-private.asc  bank/ca/bank-pgp-private.asc
cp toll-pgp-public.asc   bank/ca/toll-pgp-public.asc   # toll ki PGP public key

# toll/ca/
cp ca.crt                toll/ca/ca.crt
cp toll-server.crt       toll/ca/server.crt
cp toll-server.key       toll/ca/server.key
cp toll-client.crt       toll/ca/client.crt
cp toll-client.key       toll/ca/client.key
cp toll-sign.key         toll/ca/toll-sign.key
cp toll-public.pem       toll/ca/public.pem
cp bank-public.pem       toll/ca/bank-verify.pub      # bank ki public key
cp toll-pgp-private.asc  toll/ca/toll-pgp-private.asc
cp bank-pgp-public.asc   toll/ca/bank-pgp-public.asc   # bank ki PGP public key
```

`ca.crt` ke siwa **koi private key kabhi doosre side ke folder me copy nahi hoti** — sirf public counterparts cross karte hain. Yehi asli mTLS/PGP trust model hai.

### Verify karne ke liye

```bash
openssl verify -CAfile ca.crt bank-server.crt   # OK chahiye
openssl x509 -in bank-server.crt -noout -text | grep -A2 "Subject Alternative Name"
```
