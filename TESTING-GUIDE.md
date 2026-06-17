# mTLS + PGP + NPCI NETC — Testing & Learning Guide

Yeh document `bank/README.md` aur `toll/README.md` ka **consolidated, hands-on version** hai — sab kuch ek jagah, taaki khud test kar sako aur step-by-step samajh sako. Deep OpenSSL/GPG generation steps yahan repeat nahi kiye — uske liye `bank/README.md` ya `toll/README.md` ka "OpenSSL/GPG se generate karna" section dekho (dono me same hai).

---

## 0. Kitna time lagega — honest estimate

| Goal | Time |
|---|---|
| **Sirf chalakar dekhna** (test commands copy-paste karo, output dekho) | 30–45 min |
| **Concepts samajhna** (mTLS, XML signature, PGP — yeh teen layers kya aur kyun) | +2–3 ghante |
| **Code padhna** (controllers/services line-by-line, samajhna ki har step kaise kaam karta hai) | +3–4 ghante |
| **NPCI NETC schema + real-world context** (kaunsa real hai, kaunsa simplified) | +1–2 ghante |
| **Poori tarah confident** (khud se ek naya message type add kar sako) | Total ~8–12 ghante, 2–3 din me phaila ke |

Agar tumhe pehle se HTTPS/TLS basics aate hain, to time kam lagega (~5-6 ghante). Agar bilkul naya topic hai, to upar wala range realistic hai — ek hi din me sab kuch jaldi-jaldi padhne ki koshish mat karo, concepts overlap karte hain aur confuse ho jaoge.

**Suggested order** (niche ke sections isi order me hain):
1. System overview (5 min read)
2. File reference table (15 min — ek baar padho, baar baar reference karoge)
3. Hands-on testing (30-45 min — pehle yeh karo, phir concepts clearer lagenge)
4. Message types + schema detail (1-2 ghante)
5. Code padhna (controllers/services) — sabse last, jab upar wala sab clear ho jaye

---

## 1. System overview

Do Node.js servers, ek dusre se baat karte hain 3 security layers ke through:

```
TOLL (localhost:9443)                              BANK (localhost:8443)
"Bhagat Toll Plaza"                                 "ABC Bank"

 1. XML banao (etc:ReqPay jaisa schema)
 2. RSA-SHA256 se XML sign karo          ──┐
 3. PGP se {xml, signature} encrypt karo   │  Security layers
 4. mTLS HTTPS POST (client cert bhejo) ───┘
                                          ─────────────────────>
                                                     5. mTLS: peer cert verify (CA se)
                                                     6. PGP decrypt + PGP signature verify
                                                     7. XML signature verify (RSA-SHA256)
                                                     8. Process karo (transaction store me save)
                                                     9. Response XML banao, sign, PGP encrypt
                                          <─────────────────────
 10. PGP decrypt + XML sig verify
 11. Result dikhao
```

| # | Layer | Sawaal jo yeh answer karta hai | Tool |
|---|---|---|---|
| 1 | **mTLS** | "Kya yeh sender trusted hai?" (network-level identity) | Node `https` server options (`requestCert`, `rejectUnauthorized`) |
| 2 | **RSA-SHA256 XML Signature** | "Kya data tamper hua hai?" (integrity) | Node `crypto.createSign`/`createVerify` |
| 3 | **PGP Encryption** | "Kya sirf intended receiver hi padh sakta hai?" (confidentiality) + sender ka PGP-level identity proof | `openpgp` npm package |

Yeh teeno **independent** hain — koi ek fail ho jaye to baaki kaam karte rehte hain, aur teeno ko break karna padega attacker ko data tamper karne/padhne ke liye.

---

## 2. File reference — sab `.crt`/`.key`/`.pem`/`.asc` files ek jagah

### TLS / mTLS files (`ca/server.*`, `ca/client.*`, `ca/ca.crt`)

Har side (`bank/ca/` aur `toll/ca/` dono me) **2 alag identity** hoti hain, kyunki har side dono roles play karta hai:

| Role | Kab use hota hai | Files | Kis side se kis side |
|---|---|---|---|
| **Server** | Jab yeh side koi connection **accept** kar raha ho | `server.crt`, `server.key` | Bank: toll ke ReqPay/ChkTxn/Refund/TagDetails/Heartbeat/SyncTime calls accept karta hai. Toll: bank ke Heartbeat/SyncTime calls accept karta hai |
| **Client** | Jab yeh side khud kisi ko **call** kar raha ho | `client.crt`, `client.key` | Toll → Bank (sab kuch), Bank → Toll (Heartbeat/SyncTime) |
| **Trust anchor** | Dono roles me — doosre ka cert verify karne ke liye | `ca.crt` (same file, dono `ca/` folders me copy) | — |

> **Important:** `server.crt`/`client.crt` dono ka `Extended Key Usage` same hai (`TLS Web Server Authentication, TLS Web Client Authentication`) — yani cryptographically dono swap-able hain. Separation sirf naming-convention se hai, cert-level restriction nahi (real production CA me aksar yeh restrict kiya jata hai).

### XML-signing RSA keys (certificates NAHI — raw RSA keypairs)

| File | Konsa side | Role |
|---|---|---|
| `bank-sign.key` | bank ke `ca/` me | Bank apna outgoing XML isse sign karta hai |
| `toll-sign.key` | toll ke `ca/` me | Toll apna outgoing XML isse sign karta hai |
| `public.pem` (har side ke apne `ca/` me) | **Apne** sign-key ka public counterpart — apna app isse load **nahi** karta, sirf distribution-source hai | — |
| `toll-verify.pub` (bank ke `ca/` me) | Toll ke `public.pem` ki copy | Bank isse toll ka XML signature verify karta hai |
| `bank-verify.pub` (toll ke `ca/` me) | Bank ke `public.pem` ki copy | Toll isse bank ka XML signature verify karta hai |

### PGP keys (armored `.asc`)

| File | Konsa side | Role |
|---|---|---|
| `bank-pgp-private.asc` | sirf bank ke `ca/` me | Bank decrypt + apna PGP-sign isse karta hai |
| `toll-pgp-private.asc` | sirf toll ke `ca/` me | Toll decrypt + apna PGP-sign isse karta hai |
| `bank-pgp-public.asc` (bank ke apne `ca/` me) | Apni public key ka master copy — bank ka apna code isse load **nahi** karta (config.js me reference nahi) | — |
| `toll-pgp-public.asc` (toll ke apne `ca/` me) | Same — sirf distribution source | — |
| `toll-pgp-public.asc` (**bank** ke `ca/` me — yeh copy hai) | Bank isse toll ko encrypt karta hai + toll ka signature verify karta hai | |
| `bank-pgp-public.asc` (**toll** ke `ca/` me — yeh copy hai) | Toll isse bank ko encrypt karta hai + bank ka signature verify karta hai | |

**Golden rule (dono — TLS sign-keys aur PGP keys ke liye):** Jo file `<side>/ca/` me khud apne naam se (`bank-*` bank ke folder me, `toll-*` toll ke folder me) sirf **public** version ke roop me baithi hai, woh **load nahi hoti** — sirf reference/distribution copy hai. Jo file **doosre side ke naam se** apne folder me hai (`toll-verify.pub`, `bank-pgp-public.asc` toll ke andar), woh **actually use hoti hai**.

---

## 3. Message types — sab 6, ek table me

Sab NPCI NETC ke `http://npci.org/etc/schema/` namespace follow karte hain (values **XML attributes** me — `<Head msgId="..." ts="..."/>`, nested tags nahi).

| # | Message | Kaun initiate karta hai | Real NPCI schema? | Konsa endpoint |
|---|---|---|---|---|
| 1 | **ReqPay / RespPay** | Toll → Bank | ✅ `etc:ReqPay` / `RespPay` | `POST /api/payment` (bank), `GET /api/send-payment` + `POST /api/fasttag/payment` (toll) |
| 2 | **Heartbeat** | Dono direction | ✅ `etc:TollplazaHbeatReq` / `RespHbeat` | `POST /api/heartbeat`, `GET /api/send-heartbeat` (dono side) |
| 3 | **SyncTime** | Dono direction | ✅ `etc:ReqSyncTime` / `RespSyncTime` | `POST /api/synctime`, `GET /api/send-synctime` (dono side) |
| 4 | **ReqChkTxn** | Toll → Bank | ✅ `etc:ReqChkTxn` / `ResChkTxn` | `POST /api/check-txn` (bank), `GET /api/send-check-txn` (toll) |
| 5 | **ReqRefund** | Toll → Bank | ⚠️ Real NPCI me nahi milta — sirf consistency ke liye same style | `POST /api/refund` (bank), `GET /api/send-refund` (toll) |
| 6 | **ReqTagDetails** | Toll → Bank | ✅ `etc:ReqTagDetails` / `RespTagDetails` | `POST /api/list-account` (bank), `GET /api/send-list-account` (toll) |

**Heartbeat/SyncTime automatic hain** — `NetcRuntimeService.start()` server start hote hi turant fire karta hai, fir interval pe repeat (`NETC_HEARTBEAT_INTERVAL_SEC`=30s demo / `NETC_TIME_SYNC_INTERVAL_SEC`=300s demo, real prod 300s/14400s). Manual GET endpoints sirf testing ke liye hain.

**Simplification jo liya gaya:** Real NETC me bank turant result nahi deta, sirf ACK deta hai — asli result alag async callback se aata hai. Yahan **sab synchronous** hai (simplicity ke liye).

---

## 4. Hands-on testing — step by step

### Prerequisites

```bash
cd bank && npm install && cd ../toll && npm install && cd ..
```

### Step 1 — Dono server start karo (2 alag terminal/background)

```bash
cd bank && npm start
```
```bash
cd toll && npm start
```

Dono ke logs me dekho — startup ke 1-2 second baad **automatically** Heartbeat aur SyncTime exchange ho jana chahiye (bina kisi manual command ke). Yeh confirm karta hai mTLS + PGP + XML-sign teeno layers sahi se kaam kar rahe hain.

### Step 2 — Test client use karo

Windows ka built-in `curl` (schannel) PEM client cert directly load nahi kar pata, isliye iske jagah `test-request.mjs` (isi repo ke root me) use karo:

```bash
node test-request.mjs <bank|toll> <GET|POST> "<path>" ['<json-body>']
```

> **Shell note:** PowerShell me upar wala command jaisa hai waisa hi chalega. **Git Bash** (ya iss repo ka Bash tool) use kar rahe ho to leading `/` wale path ko MSYS automatically Windows path me convert kar deta hai (`/health` → `C:/Program Files/Git/health`) — usse bachne ke liye command se pehle `MSYS_NO_PATHCONV=1` lagao:
> ```bash
> MSYS_NO_PATHCONV=1 node test-request.mjs toll GET "/health"
> ```

### Step 3 — Health check

```bash
node test-request.mjs toll GET "/health"
node test-request.mjs bank GET "/health"
```

### Step 4 — ReqPay (quick test, fake tag/tid)

```bash
node test-request.mjs toll GET "/api/send-payment?vehicle=MH12AB1234&amount=80"
```
Response me `transactionId` note kar lo — agle steps me chahiye hoga.

### Step 5 — ReqPay real data (jaisa RFID reader/Postman bhejega)

```bash
node test-request.mjs toll POST "/api/fasttag/payment" "{\"tagid\":\"E20034120125A7000016ABCD\",\"tid\":\"E00401021234567890ABCDEF\",\"vehno\":\"MH12AB1234\",\"vehicleclass\":\"4\",\"toll_fare\":\"65.00\",\"lane_id\":\"LANE-02\"}"
```
Response me `decision: { action: 'open_barrier', traffic_light: 'green' }` aana chahiye.

### Step 6 — ReqChkTxn (Step 4/5 ka transactionId use karo)

```bash
node test-request.mjs toll GET "/api/send-check-txn?txnId=TXN-XXXXXXXXXXXXX"
```
Ek non-existent ID se bhi try karo — `result="NOT_FOUND"` aana chahiye.

### Step 7 — ReqRefund

```bash
node test-request.mjs toll GET "/api/send-refund?txnId=TXN-XXXXXXXXXXXXX&reason=CUSTOMER_REQUEST"
```
Dobara same command chalao — `result="ALREADY_REFUNDED"` aana chahiye. Fir Step 6 wapas chalao — ab `result="REFUNDED"` aana chahiye.

### Step 8 — ReqTagDetails (account lookup)

```bash
node test-request.mjs toll GET "/api/send-list-account?vehicle=MH12AB1234"   # ACTIVE
node test-request.mjs toll GET "/api/send-list-account?vehicle=KA05XY9999"   # BLACKLISTED
node test-request.mjs toll GET "/api/send-list-account?vehicle=ZZ99ZZ0000"   # NOT_FOUND
```

### Step 9 — Heartbeat/SyncTime manually trigger (auto ke alawa)

```bash
node test-request.mjs toll GET "/api/send-heartbeat"
node test-request.mjs bank GET "/api/send-heartbeat"
node test-request.mjs toll GET "/api/send-synctime"
node test-request.mjs bank GET "/api/send-synctime"
```

### Step 10 — Servers band karo (Ctrl+C dono terminal me)

---

## 5. Self-check — kya samajh aaya, verify karo

Niche ke sawaalon ka jawab khud de pao to woh stage clear samjho:

- [ ] mTLS me `server.crt` aur `client.crt` me kya fark hai, aur toll ke paas dono kyun hain?
- [ ] `ca.crt` ka role kya hai — yeh kisi message ko encrypt/decrypt karta hai?
- [ ] XML signature aur PGP signature — dono alag kyun hain, ek hi kaam ke liye 2 signature kyun?
- [ ] `bank/ca/bank-pgp-public.asc` file hai, par bank ka code isse load nahi karta — kyun?
- [ ] Real NPCI me Heartbeat/SyncTime kaise trigger hote hain — manual call se ya automatically?
- [ ] ReqRefund "real NPCI message" kyun nahi hai, phir bhi project me kyun hai?
- [ ] Agar `xmlOk` false aaye (signature invalid), to request ka kya hota hai? (`receivePayment` jaisa controller dekho)
- [ ] Transaction store restart pe khali kyun ho jata hai — yeh kya represent karta hai real system me (database vs in-memory)?

Agar sab answer kar pao bina code dekhe — poori tarah samajh aa gaya. Agar 2-3 me atak rahe ho, unhi sections ko `bank/README.md`/`toll/README.md` me wapas padho.
