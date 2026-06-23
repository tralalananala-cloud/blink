# Blink — Security & Threat Model

> Honesty first: we state what we protect **and what we don't**. Blink uses audited
> primitives (libsignal, @noble/Cure53), but **our integration has not been independently
> audited**. We do not display an "AUDITED" badge.

## What Blink protects

- **Message content** — E2EE via **libsignal** (X3DH + **PQXDH post-quantum / Kyber-ML-KEM** + Double Ratchet). The relay cannot read messages.
- **Identity without PII** — an on-device key (`did:key`), no phone number or email. BIP39 recovery phrase.
- **Anti-MITM** — safety number (SHA-256 over both real identity keys) + QR verification + key-change alert.
- **Sealed sender** — the relay does not see WHO is sending (only the recipient, for routing).
- **At rest (Android)** — keys in the Android Keystore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), messages in encrypted SQLite (ChaCha20-Poly1305).
- **On device** — app lock (password + biometrics), per-conversation passwords, disappearing messages, anti-screenshot, RAM hygiene on background.

## What Blink does NOT protect (assumed limitations)

- **Network metadata** — the relay (Cloudflare) sees your **IP, timing and volume**. Sealed sender hides the sender's DID, NOT the network path. Tor/I2P is on the roadmap.
- **Impersonation on UNVERIFIED contacts (sealed sender)** — the sealed envelope does not cryptographically authenticate the sender at the outer layer (`sd` is self-declared; the inner libsignal message is authenticated). An attacker who knows your public key + a victim DID could attempt to impersonate an **unverified** contact. **Defense: verify the safety number** (the app nudges you). [audit #2]
- **Compromised device** — root/malware/keylogger defeats any messenger. We protect content, not a hostile OS.
- **Desktop (Electron) at rest** — on desktop, secrets live in `localStorage` (not OS-encrypted) → "at rest" encryption is weak without full-disk encryption. Android is the safe path; desktop is parked. [audit #3]
- **Not audited** — the primitives are audited, the Blink integration is not. Plan: open-source + reproducible builds + bug bounty.

## Internal audit results (2026-06-22)

**Fixed:** removed the false "AUDITED" badge (`isAudited=false`); deleted dead code using a non-cryptographic hash; constant-time password comparison; relay with **rate-limit + queue cap** anti-spam + reduced DID logging.

**App password (#4) — nuance:** pure-JS scrypt blocks the UI thread on the phone (Hermes) for several seconds → we reverted to fast SHA-256. On Android the hash is protected by the Android Keystore, so this is acceptable. A real slow KDF (against brute-force on an extracted hash, relevant mainly on desktop) requires a native module — **deferred**.

**Documented / on the roadmap:** #2 sealed-sender impersonation (mitigated by the safety number), #3 desktop plaintext (desktop parked), #7 DID derived with truncation (MITM still caught by the safety number; changing it would break identities), #8 minor modulo bias in safety-number display (negligible), #12 AEAD without AAD on local storage (changing it would invalidate existing data).

## Reporting vulnerabilities

Open a private GitHub Security Advisory on the Blink repository. Coordinated disclosure, with no legal action against good-faith research.
