# Bhagat Toll Plaza — mTLS + PGP + NPCI NETC Learning Server

Yeh "Bhagat Toll Plaza" ek **mock toll/acquirer-side server** hai jo `https://localhost:9443` par chalta hai. Yeh real-world FASTag/NETC toll-bank integration (NPCI NETC) ka simplified, learning-purpose clone hai — yeh server `bank/` folder wale "ABC Bank" ko payment/heartbeat/synctime/tag-lookup requests bhejta hai (aur kuch requests bank se receive bhi karta hai).

> Koi bhi cert/key/PGP key isme **real nahi hai** — sab self-generated, sirf is repo ke liye. XML schema NPCI ke publicly-documented NETC spec se inspired hai, lekin real production endpoints/keys se koi connection nahi.

## Architecture — 3 security layers ek dusre ke upar

```
Toll (yeh server)                                Bank
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
| **XML Digital Signature** (integrity + non-repudiation) | Payload XML ko sender apni RSA private key se sign karta hai; receiver sender ki RSA public key se verify karta hai — tamper hua to signature fail ho jata hai | Node `crypto.createSign('SHA256')` / `crypto.createVerify('SHA256')` | `ca/toll-sign.key` (sign), `ca/bank-verify.pub` (verify) |
| **PGP Encryption** (confidentiality + sender-id) | `{xml, xmlSignature}` JSON ko receiver ki PGP public key se encrypt karo, apni PGP private key se PGP-sign karo | `openpgp` npm package | `ca/toll-pgp-private.asc` (decrypt), `ca/bank-pgp-public.asc` (encrypt+verify) |

Teeno independent hain — mTLS sirf "kaun connect kar raha hai" check karta hai (network layer), XML signature "data tamper nahi hua" check karta hai (application layer), PGP "sirf intended receiver hi padh sakta hai" ensure karta hai (message layer).

## Message types (NPCI NETC schema)

Real NPCI NETC integration spec (`http://npci.org/etc/schema/` namespace) follow karte hain — values **XML attributes** me hote hain, nested tags me nahi (`<Head msgId="..." ts="..."/>`, tags nahi `<MessageId>...</MessageId>`).

| Message | Route (toll side) | Direction | Schema | Real NPCI? |
|---|---|---|---|---|
| **ReqPay / RespPay** | `GET /api/send-payment` (quick test), `POST /api/fasttag/payment` (real RFID/Postman data) | Toll → Bank | `etc:ReqPay` request, `RespPay` response | ✅ Real schema |
| **Heartbeat** | `GET /api/send-heartbeat` (toll → bank), `POST /api/heartbeat` (receive) | Bidirectional | `etc:TollplazaHbeatReq` / `RespHbeat` | ✅ Real schema |
| **SyncTime** | `GET /api/send-synctime` (toll → bank), `POST /api/synctime` (receive) | Bidirectional | `etc:ReqSyncTime` / `RespSyncTime` | ✅ Real schema |
| **ReqChkTxn** | `GET /api/send-check-txn?txnId=...` | Toll → Bank | `etc:ReqChkTxn` / `ResChkTxn` | ✅ Real schema |
| **ReqRefund** | `GET /api/send-refund?txnId=...&reason=...` | Toll → Bank | `ReqRefund` / `RespRefund` (Head/Txn/Resp style) | ⚠️ **Real NPCI me yeh message type nahi milta** — refunds NETC me settlement/dispute process se hote hain, per-txn API call se nahi. Sirf consistency ke liye same attribute-style rakha hai (bina `etc:` namespace ke) |
| **ReqTagDetails** | `GET /api/send-list-account?vehicle=...` | Toll → Bank | `etc:ReqTagDetails` / `RespTagDetails` | ✅ Real schema |

**Important simplification:** Real NETC me bank turant HTTP response me result nahi deta — sirf ACK deta hai, asli result baad me ek **alag async callback** (`/callback/responsepay` jaisa) se aata hai, aur toll ek pending-transaction store + retry timer rakhta hai. Yeh demo **synchronous** hai (same HTTP response me sab result aa jata hai) — simplicity ke liye yeh trade-off liya gaya hai.

## Vehicle entry flow (`POST /api/fasttag/payment`)

Jab ek vehicle lane pe aati hai, real system me RFID reader/lane-software backend ko scan data POST karta hai (real route: `/fasttag/payment`, real field names: `tagid`, `tid`, `vehno`, `vehicleclass`, `lane_id`, `toll_fare`) — yahi naming yahan follow ki gayi hai:

```bash
curl --cert ca/client.crt --key ca/client.key --cacert ca/ca.crt \
  -X POST https://localhost:9443/api/fasttag/payment \
  -H "Content-Type: application/json" \
  -d '{"tagid":"E20034120125A7000016ABCD","tid":"E00401021234567890ABCDEF","vehno":"MH12AB1234","vehicleclass":"4","toll_fare":"65.00","lane_id":"LANE-02"}'
```

> **Windows note:** Windows ka built-in `curl` (schannel backend) PEM client cert (`--cert`/`--key`) directly load nahi kar pata (`schannel: Failed to import cert file` error dega). Windows pe test karne ke liye Postman use karo (client cert Settings → Certificates me add karo) ya Node ke `https` module se ek chhota script likho (`cert`/`key`/`ca` options ke saath) — Git Bash wala curl bhi same OS-level schannel issue se affected hota hai.

Is data se `etc:ReqPay` XML banta hai → sign → PGP encrypt → mTLS POST bank ko → bank ka `RespPay` aata hai → uske `Resp result=` attribute se ek **lane decision** banta hai (`buildPaymentDecision()`, real `TagController.buildPaymentDecision()` ka simplified version):

- `result="ACCEPTED"` → `{ action: 'open_barrier', traffic_light: 'green' }`
- otherwise → `{ action: 'switch_to_cash_or_upi', traffic_light: 'red' }`

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
GET  /api/send-payment?vehicle=MH12AB1234&amount=50           — ReqPay quick test (fake tag/tid)
POST /api/fasttag/payment                                       — ReqPay real RFID/Postman data
GET  /api/send-check-txn?txnId=TXN-...                          — ReqChkTxn
GET  /api/send-refund?txnId=TXN-...&reason=CUSTOMER_REQUEST     — ReqRefund
GET  /api/send-list-account?vehicle=MH12AB1234                  — ReqTagDetails
GET  /api/send-heartbeat                                         — Heartbeat manually trigger (testing)
GET  /api/send-synctime                                          — SyncTime manually trigger (testing)
POST /api/heartbeat                                               — Heartbeat receive (bank se)
POST /api/synctime                                                — SyncTime receive (bank se)
GET  /health                                                       — status check
```

## Setup aur run

```bash
npm install
npm start        # node app.js
npm run dev       # nodemon app.js (auto-restart)
```

`.env` file env vars (`config/config.js` `path.join(root, '.env')` se load karta hai):

```
PORT=9443
HOST=0.0.0.0
BANK_HOST=localhost
BANK_PORT=8443

TLS_SERVER_CERT=ca/server.crt
TLS_SERVER_KEY=ca/server.key
TLS_CA_CERT=ca/ca.crt
TLS_CLIENT_CERT=ca/client.crt     # toll → bank calls ke liye
TLS_CLIENT_KEY=ca/client.key

TOLL_SIGN_KEY=ca/toll-sign.key
BANK_VERIFY_PUB=ca/bank-verify.pub

TOLL_PGP_PRIVATE=ca/toll-pgp-private.asc
BANK_PGP_PUBLIC=ca/bank-pgp-public.asc
TOLL_PGP_PASSPHRASE=toll-pgp-secret-2024
```

> Postman se test karte ho to mTLS handshake ke liye `ca/client.crt` + `ca/client.key` ko Postman ke Client Certificates settings me `localhost:9443` ke against add karna padega — Windows curl (schannel) PEM client cert directly load nahi kar pata.

## `ca/` folder — file-by-file

| File | Kya hai | Kahan use hota hai |
|---|---|---|
| `ca.crt` | Shared Root CA ka certificate (bank aur toll dono ke server/client cert isi se signed hain) | TLS server `ca` option — bank ka cert verify karne ke liye |
| `server.crt` / `server.key` | Toll ke HTTPS server ka apna cert+key (CN=`toll.mtls.local`) | `https.createServer()` me `cert`/`key` |
| `client.crt` / `client.key` | Toll ka **client identity** (CN=`toll-client`) — jab toll bank ko call karta hai (ReqPay/Heartbeat/SyncTime/etc.) | `services/PaymentService.js` ka `sendToBank()` mTLS client options |
| `toll-sign.key` | Toll ki RSA private key — apna outgoing XML sign karne ke liye | `signXml()` |
| `public.pem` | `toll-sign.key` ka public counterpart — **yeh hi file bank ko `bank/ca/toll-verify.pub` ke naam se di jaati hai** | Reference/distribution copy — app ise directly use nahi karta |
| `bank-verify.pub` | Bank ke `bank-sign.key` ka public key (bank ne diya) — bank ka XML signature verify karne ke liye | `verifyXmlSig()` |
| `toll-pgp-private.asc` | Toll ki PGP private key (armored) — incoming PGP messages decrypt karne ke liye, passphrase `.env` me | `pgpDecrypt()` / `pgpEncrypt()` (signing) |
| `bank-pgp-public.asc` | Bank ki PGP public key (bank ne diya) — bank ko encrypt karne ke liye + bank ka PGP signature verify karne ke liye | `pgpEncrypt()` / `pgpDecrypt()` (verify) |

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

### 2. Toll ka server certificate (mTLS server identity)

```bash
openssl genrsa -out toll-server.key 2048
openssl req -new -key toll-server.key \
  -subj "/CN=toll.mtls.local/O=Bhagat Toll Plaza/C=IN" \
  -out toll-server.csr

openssl x509 -req -in toll-server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 1825 -sha256 \
  -extfile <(printf "subjectAltName=DNS:localhost,DNS:toll.mtls.local,IP:127.0.0.1") \
  -out toll-server.crt
```

`subjectAltName` (SAN) zaroori hai — Node TLS client `localhost` se connect karta hai, isliye SAN list me `DNS:localhost` aur `IP:127.0.0.1` dono honi chahiye, warna hostname-mismatch error aayega.

### 3. Toll ka client certificate (jab toll bank ko call kare)

```bash
openssl genrsa -out toll-client.key 2048
openssl req -new -key toll-client.key \
  -subj "/CN=toll-client/O=Bhagat Toll Plaza/C=IN" \
  -out toll-client.csr

openssl x509 -req -in toll-client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 1825 -sha256 -out toll-client.crt
```

Client cert me SAN ki zaroorat nahi (browser/server jaisa hostname-check client cert pe nahi hota, sirf CA-chain validate hoti hai).

### 4. Bank ka server + client certificate (same pattern)

```bash
openssl genrsa -out bank-server.key 2048
openssl req -new -key bank-server.key \
  -subj "/CN=bank.mtls.local/O=ABC Bank Ltd/C=IN" \
  -out bank-server.csr
openssl x509 -req -in bank-server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 1825 -sha256 \
  -extfile <(printf "subjectAltName=DNS:localhost,DNS:bank.mtls.local,IP:127.0.0.1") \
  -out bank-server.crt

openssl genrsa -out bank-client.key 2048
openssl req -new -key bank-client.key \
  -subj "/CN=bank-client/O=ABC Bank Ltd/C=IN" \
  -out bank-client.csr
openssl x509 -req -in bank-client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -days 1825 -sha256 -out bank-client.crt
```

### 5. XML-signing RSA keypairs (yeh certificates NAHI hain — sirf raw RSA keys)

XML digital signature ke liye CA-signed certificate ki zaroorat nahi, sirf ek RSA keypair chahiye (jaisa JWT RS256 me hota hai):

```bash
openssl genrsa -out toll-sign.key 2048
openssl rsa -in toll-sign.key -pubout -out toll-public.pem

openssl genrsa -out bank-sign.key 2048
openssl rsa -in bank-sign.key -pubout -out bank-public.pem
```

### 6. PGP keypairs (GPG CLI se)

```bash
gpg --batch --passphrase "toll-pgp-secret-2024" --quick-generate-key \
  "Bhagat Toll Plaza <toll@mtls.local>" rsa3072 encrypt,sign 2y
gpg --armor --export toll@mtls.local > toll-pgp-public.asc
gpg --pinentry-mode loopback --passphrase "toll-pgp-secret-2024" \
  --armor --export-secret-keys toll@mtls.local > toll-pgp-private.asc

gpg --batch --passphrase "bank-pgp-secret-2024" --quick-generate-key \
  "ABC Bank <bank@mtls.local>" rsa3072 encrypt,sign 2y
gpg --armor --export bank@mtls.local > bank-pgp-public.asc
gpg --pinentry-mode loopback --passphrase "bank-pgp-secret-2024" \
  --armor --export-secret-keys bank@mtls.local > bank-pgp-private.asc
```

### 7. Files ko sahi jagah copy karo

```bash
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
```

`ca.crt` ke siwa **koi private key kabhi doosre side ke folder me copy nahi hoti** — sirf public counterparts cross karte hain. Yehi asli mTLS/PGP trust model hai.

### Verify karne ke liye

```bash
openssl verify -CAfile ca.crt toll-server.crt   # OK chahiye
openssl x509 -in toll-server.crt -noout -text | grep -A2 "Subject Alternative Name"
```
