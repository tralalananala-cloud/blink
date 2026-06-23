# Blink

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Android-3ddc84.svg)](https://github.com/tralalananala-cloud/blink/releases/latest)
[![Latest release](https://img.shields.io/github/v/release/tralalananala-cloud/blink)](https://github.com/tralalananala-cloud/blink/releases/latest)
[![Encryption](https://img.shields.io/badge/crypto-libsignal%20%2B%20post--quantum-7c3aed.svg)](SECURITY.md)
[![Website](https://img.shields.io/badge/website-blinkmessenger.vercel.app-0ea5e9.svg)](https://blinkmessenger.vercel.app)

> A decentralized, end-to-end-encrypted messenger. **No phone number, no email** —
> your identity is a key you hold. Post-quantum encryption via the official libsignal.

Blink is a privacy-first chat app: messages are encrypted on your device with
**libsignal** (X3DH + **PQXDH post-quantum / Kyber-ML-KEM** + Double Ratchet), the same
protocol family Signal uses, but **without requiring a phone number or email**. The relay
that forwards your traffic is *blind* — it cannot read messages, and with **sealed sender**
it does not learn who sent them.

> ⚠️ **Honest status.** Blink uses audited primitives (libsignal, [@noble](https://github.com/paulmillr/noble-hashes) audited by Cure53),
> but **our integration has not been independently audited.** We do **not** display an
> "AUDITED" badge. Android is the supported platform; desktop is parked and iOS is not yet
> shipped. Read [SECURITY.md](SECURITY.md) for the full threat model — what we protect and
> what we don't (network metadata / IP is still visible to the relay; Tor/I2P is on the roadmap).

## Why Blink

- **No identifiers.** Identity is a `did:key` on your device + a BIP39 recovery phrase. No phone, no email, no PII.
- **Post-quantum content encryption.** libsignal with PQXDH (Kyber/ML-KEM) — on par with Signal, ahead of most.
- **Sealed sender.** The relay routes by recipient only; it does not see who sent a message.
- **On-device hardening.** App lock + per-conversation passwords, disappearing messages, anti-screenshot, encrypted SQLite storage (ChaCha20-Poly1305), keys in the Android Keystore.
- **Anti-MITM.** Safety numbers (SHA-256 over both real identity keys) with QR verification and key-change alerts.
- **No telemetry, no analytics, no "calling home."**

## Architecture

```
.                      React Native / Expo app (Android) — expo-router, zustand, i18n RO+EN
├── app/               Screens (file-based routing)
├── src/
│   ├── crypto/        CryptoEngine interface — UI talks ONLY to this.
│   │                  libsignalEngine.ts = real X3DH + Double Ratchet + PQXDH (native, Android)
│   │                  signalEngine.ts    = pure-JS X3DH/Double Ratchet over @noble (desktop)
│   ├── messaging/     relay.ts = WebSocket client + offline outbox + delivery acks
│   ├── crypto/signal/ X3DH / Double Ratchet building blocks
│   ├── identity/      did.ts = mnemonic, did:key, safety number
│   ├── storage/       db.ts = encrypted KV (ChaCha20-Poly1305), secure.ts = SecureStore wrapper
│   ├── security/      lock.ts = app + per-conversation passcodes
│   ├── media/         wire.ts = chunked encrypted media transfer
│   └── state/         store.ts = zustand + encrypted persist
├── desktop/           Electron wrapper over the Expo web export (parked; see SECURITY.md)
└── relay/             Cloudflare Worker + Durable Object — the blind store-and-forward relay
    └── cf-worker/     src/index.js = Worker + Relay DO (WebSocket Hibernation, SQLite, sharded per-DID)
```

The relay is **stateless about content**: it stores encrypted envelopes for offline delivery,
routes by recipient DID (sharded Durable Objects), and runs **zero-log** (no DID/metadata logging).
Secrets (FCM push credentials) live in Worker secrets, never in the repo.

## Build

### Mobile app (Android)

Requires **Node 20** (Expo SDK 52 breaks on newer Node), a JDK 17, and the Android SDK.

```bash
export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/Android/Sdk
npm install --legacy-peer-deps
npx expo prebuild --clean
cd android && ./gradlew assembleRelease
```

Output APKs are split per ABI in `android/app/build/outputs/apk/release/`
(`arm64-v8a` ≈ 97 MB is the one most phones need). Install with `adb install -r <apk>`.

> Note: a forked build needs your own `google-services.json` (for FCM push) and your own
> release keystore. The committed `app.json` references an Expo project (`extra.eas.projectId`)
> owned by the original author — run `eas init` to point it at yours, or remove it for a
> local-only build.

### Relay (Cloudflare Worker)

```bash
cd relay/cf-worker
npm install
npx wrangler deploy
```

Set the FCM push secrets with `wrangler secret put FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY / FCM_PROJECT_ID`.
`relay/server.js` is a Node dev relay for LAN testing only.

### Tests

```bash
npx tsc          # type-check
npx jest         # unit tests (session / crypto contract)
```

## Security

See **[SECURITY.md](SECURITY.md)** for the threat model and the internal audit results.
To report a vulnerability, open a private GitHub Security Advisory on this repository.
Coordinated disclosure; no legal action against good-faith research.

## License

[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0). If you run a modified Blink
relay or service for others, you must make your source available to them.
