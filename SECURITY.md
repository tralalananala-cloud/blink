# Blink — Security & Threat Model

> Honest first: we state what we protect **and what we do NOT**. Blink uses audited primitives
> (libsignal, @noble/Cure53), but **our integration has not been independently audited**. We do
> not display "AUDITED".

## What Blink protects
- **Message content** — E2EE via **libsignal** (X3DH + **post-quantum PQXDH / Kyber-ML-KEM** + Double Ratchet). The relay cannot read messages.
- **Identity without PII** — on-device key (DID:key), no phone number/email. BIP39 recovery phrase.
- **Anti-MITM** — safety number (SHA-256 over both real keys) + QR verification + key-change alert.
- **Sealed sender** — the relay does not see WHO is sending (only the recipient, for routing).
- **At rest (Android)** — keys in Keystore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); messages in SQLite with **per-message encrypted content** (ChaCha20-Poly1305). Full-file SQLCipher encryption = planned; index metadata (timestamp) stays in the clear. On web/desktop: encrypted local storage, not SQLite.
- **On device** — app lock (**scrypt** password + biometrics), per-conversation password, disappearing messages, anti-screenshot, RAM hygiene on backgrounding.

## What it does NOT protect (assumed limitations)
- **Network metadata** — the relay (Cloudflare) sees your **IP, timing and volume**. Sealed sender hides the sender's DID, NOT the network path. Tor = on the roadmap.
- **Push (FCM)** — with notifications active (app closed), the relay stores the **DID→FCM token** mapping; Google (FCM) sees **token↔timing**, the relay sees **DID↔token**. Content stays E2EE (push is only a "you have a message" signal, no text). With push disabled → **zero Google involvement**.
- **Impersonation on UNVERIFIED contacts (sealed sender)** — the sealed envelope does not cryptographically authenticate the sender at the **outer** level (`sd` is self-declared). Real authenticity comes from the **inside**: the libsignal message only decrypts under `sd`'s session, so a fake `sd` fails at decryption. In addition, since the 2026-06-24 audit **the DID = sha256(idKey ‖ authPub)** and is verified at session establishment + at the relay → a relay **can no longer substitute the key** (a first-contact MITM is blocked cryptographically, not just by the safety number). Residual: on a contact you have never added, still verify the safety number. [audit #2/#6]
- **Compromised device** — root/malware/keylogger defeats any messenger. We protect content, not a hostile OS.
- **Desktop (Electron) at rest** — on desktop secrets sit in `localStorage` (not OS-encrypted) → "at rest" encryption is weak without full-disk encryption. Android is the safe path; desktop is parked. [audit #3]
- **Local radio trace, with Bluetooth on (v1.5.0)** — while the Bluetooth transport is active, the phone **advertises continuously** with a **stable** identifier derived from your DID (`did8` = the first 8 bytes of SHA-256(DID)). It does not reveal the DID and does not expose content, but anyone **physically nearby** with a BLE scanner can **correlate the presence of the same phone across time and place** (e.g. "device X passes here every day at 8:00"). This is a *local* traceability, not a network one — but it is real. **Identifier rotation** (HMAC over a time window) is on the roadmap. Until then: if you fear physical tracking, **keep the Bluetooth transport off** (it is off by default).
- **Bluetooth ≠ mesh** — Bluetooth delivery is **direct, in proximity**: there is no multi-hop and no store-and-forward through other people's phones. Don't rely on it as a censorship-resistant network; it is a shortcut when the recipient is next to you.
- **Not audited** — the primitives are audited, Blink's integration is not. Plan: open source + reproducible builds + bug bounty.

## Internal audit result (2026-06-22)
**Fixed:** fake "AUDITED" badge removed (`isAudited=false`); dead code with a non-cryptographic hash deleted; constant-time password comparison; relay with **rate-limit + queue cap** anti-spam + reduced DID logging.

**App password (#4) — nuance:** pure-JS scrypt blocks the UI thread on the phone (Hermes) for several seconds → we reverted to fast SHA-256. On Android the hash is protected by the Android Keystore, so it is acceptable. A real slow KDF (anti brute-force on an extracted hash, relevant mainly on desktop) requires a native module — **deferred**.

**Documented / on the roadmap:** #3 desktop plaintext (desktop parked), #8 minor modulo bias in the safety-number display (negligible), #12 AEAD without AAD on local storage (changing it would invalidate existing data).

## Audit result 2026-06-24 (Android/libsignal focus)
The old `SignalEngine` (pure-JS, a second wire format) was **DELETED** — a single engine remains: native **libsignal**. Fixed in this wave:
- **C1 — Relay auth (challenge-response).** The relay asked for zero proof of DID ownership → anyone could drain someone else's queue, overwrite the bundle, deregister, or set a push token. Now registration **signs a nonce** with an Ed25519 key derived from the seed; the relay verifies the signature + `did === base32(sha256(idKey ‖ authPub))` with WebCrypto. `reg/dereg/push/qack` require authentication; `getbundle/send` stay open (sealed = anonymous by design).
- **C2 — DID↔key binding.** At session establishment, the client verifies `didFrom(idKey, authPub) === peerDid` → a compromised relay can no longer substitute the key on first contact.
- **#7 — DID = hash, not truncation.** `base32(sha256(idKey ‖ authPub))`, non-lossy, ~200 bits → a real cryptographic commitment (replaces lossy base64 truncation).
- **#4 — Real one-time prekeys.** A pool of prekeys (monotonic ids) held by the relay and **POPped one at a time per `getbundle`** → each contact gets a different opk; also fixes the "second contact could not initiate a session" bug. Reusable last-resort prekey as fallback; signed prekey rotated every 7 days.
- **#5/#7 — Anti-replay & banner.** LRU dedupe on the envelope fingerprint (replay/re-delivery ignored) + the "re-pair" banner only rises for contacts with an existing session, 30s debounce (can no longer be spammed).

> ⚠️ Changes to the libsignal engine are type-correct + cross-verified in Node, but require an **on-device E2E test** before release. New wire format (DID + authPub + relay auth) → **everyone re-pairs** (QR).

## Vulnerability reporting
After the source is published: a private GitHub Security Advisory on the Blink repo. Coordinated disclosure, no legal action against good-faith research.
