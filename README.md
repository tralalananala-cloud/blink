# Blink

> **End-to-end encrypted** messenger — **Android**. The default path is a **single relay**
> (Cloudflare) that can't read anything. Since v1.5.0 there are also two paths that do NOT go
> through it, both experimental and off by default: **nearby Bluetooth** (direct delivery when the
> recipient is a few meters away — it is NOT a mesh, there is no multi-hop) and **Reticulum**
> (routing through a gateway). Real decentralization (multi-relay) stays on the roadmap.
> Dark-first cypherpunk aesthetic. React Native + Expo.

Blink encrypts message content end-to-end with **libsignal** (the official Signal engine):
X3DH + Double Ratchet + **post-quantum PQXDH (Kyber / ML-KEM)**. Your identity is a key that
lives **on the device only** — no phone number, no email. Messages travel through a minimal relay
that **cannot read them** (sealed sender: it doesn't even see who is sending).

The full flow (handshake → text/media/voice messages → receipts → persistence → reconnection) is
**validated end-to-end on device** (arm64 phone ↔ x86_64 emulator) through the live relay.

> **Honesty before marketing.** Blink's integration uses audited primitives
> (libsignal, @noble/Cure53), but **the integration itself has NOT been independently audited** and
> runs on Android only. See [Threat model](#threat-model) and [`SECURITY.md`](SECURITY.md).

---

## What it is and what it is NOT

| Shipped & validated on device | Explicitly deferred (v1 scope frozen) |
|---|---|
| Real **libsignal**: X3DH + Double Ratchet + **PQXDH/Kyber** post-quantum | **WebRTC** audio/video calls (code present, not physically tested) |
| Sealed sender (relay does not see the sender) | **MLS** groups |
| Blind Cloudflare relay + challenge-response auth (Ed25519) | **Desktop** (Electron) — parked, no native libsignal |
| At-rest (Android): SQLite with **per-message encrypted content** (ChaCha20-Poly1305), keys in Keystore; full-file SQLCipher = planned | **iOS** (needs an Apple account + CocoaPods tuning) |
| DID:key identity + BIP39 recovery phrase + anti-MITM safety number | Transport over **Tor / I2P**; **multi-hop** over Bluetooth |
| Text, photos, video, files, voice notes; edit/delete; themes; app-lock + per-chat password | F-Droid / push without Google |
| **Nearby Bluetooth** + **Reticulum** (experimental, opt-in) — v1.5.0 | BLE identifier rotation (today it is stable → local radio trace, see SECURITY.md) |

**Design key:** the entire UI talks to the `CryptoEngine` interface (`src/crypto/types.ts`) —
no screen touches cryptographic primitives directly. There is **a single wire engine**:
`libsignalEngine.ts` (native, Android). The old pure-JS engine (`signalEngine.ts` +
`signal/{x3dh,doubleRatchet}.ts`) was **deleted** in the 2026-06-24 audit — it was a second,
incompatible wire format. On web, `crypto/index.ts` returns an honest stub
(`UnavailableEngine`); desktop is parked.

---

## Architecture

```
app/                         # routes (expo-router, file-based)
  _layout.tsx                # fonts + providers + security guard
  index.tsx                  # gate: onboarding vs tabs
  onboarding/                # welcome → identity → phrase → biometrics
  (tabs)/                    # chats / contacts / vault / settings
  chat/[id].tsx              # conversation (presentational + state hooks)
src/
  crypto/      types.ts          # the engine CONTRACT (UI talks ONLY to this)
               libsignalEngine.ts # REAL libsignal: PQXDH + Double Ratchet (native, Android)
               signal/primitives.ts # shared @noble wrappers (db/lock/relay)
               index.ts          # libsignal on native, UnavailableEngine on web
  messaging/   relay.ts          # WS client: connect/bundle/session/send/ack/edit
               codec.ts outbox.ts # control codec + delivery reliability (at-least-once)
  storage/     db.ts             # encrypted KV (ChaCha20-Poly1305, key in SecureStore)
               messages.ts       # messages in SQLite, per-message encrypted content (write-through O(1)/event)
               secure.ts         # SecureStore (Keystore) + web fallback
  security/    lock.ts           # app-lock + per-conversation password
  identity/    did.ts            # DID:key + BIP39 recovery phrase + safety number
  state/       store.ts          # zustand (slices) + encrypted persist — ZERO private keys
  i18n/        ro.ts en.ts       # RO + EN
  components/                    # Card, GlowButton, MeshBackground, chat/*, ...
__tests__/                       # pure crypto, identity, relay wire, store, migration, ...
```

Relay: `~/cipher-relay/cf-worker` — Cloudflare Worker + Durable Object (`Relay`,
WebSocket Hibernation, SQLite storage). Challenge-response auth, at-least-once offline queue,
FCM push. Site: `~/cipher-site` → blinkmessenger.vercel.app.

### Baked-in security decisions
- Private keys / the recovery phrase pass **only** through the Android Keystore
  (`expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`). Never plain AsyncStorage/files.
- `state/store.ts` holds only the **public** identity + conversations; zero secrets.
- **DID = `base32(sha256(idKey ‖ authPub))`** — a cryptographic commitment, verified at
  session establishment + at the relay (a compromised relay cannot substitute the key → a
  first-contact MITM is blocked cryptographically, not just by the safety number).
- No telemetry, no analytics, no SDKs that "call home". The relay is **zero-log**.
- `expo-screen-capture` (anti screenshot/recording) + RAM hygiene on backgrounding.

---

## Threat model

Aligned with [`SECURITY.md`](SECURITY.md) (the canonical source — read it for details).

**We protect:**
- **Message content** — E2EE via libsignal (X3DH + PQXDH + Double Ratchet). The relay does not read it.
- **Identity without PII** — on-device key (DID:key), no phone/email. BIP39 recovery.
- **Anti-MITM** — safety number (SHA-256 over both real keys) + QR verification + key-change alert + DID↔key binding.
- **Sealed sender** — the relay does not see WHO is sending (only the recipient, for routing).
- **At rest (Android)** — keys in Keystore; messages in SQLite with per-message encrypted content (ChaCha20-Poly1305). Full-file SQLCipher = planned; the index timestamp stays in the clear.

**We do NOT protect (assumed limitations):**
- **Network metadata** — the relay (Cloudflare) sees **IP, timing, volume**. Sealed sender
  hides the sender's DID, NOT the network path. Tor/I2P = on the roadmap, not shipped.
- **Impersonation on UNVERIFIED contacts** — the sealed envelope does not authenticate the sender
  at the outer level (self-declared `sd`); real authenticity comes from the inside (the libsignal
  message only decrypts under the correct session) + the safety number. On a new contact,
  verify the safety number.
- **Compromised device** — root/keylogger/malware defeats any messenger.
- **Not independently audited** — the primitives are audited, Blink's integration is not.
- **Android only** — desktop (Electron) is parked; on it secrets would sit in unencrypted
  localStorage. The safe path is Android.

---

## Build (Android)

> Requires **Node 20** (Expo SDK 52 does not run on newer Node). `JAVA_HOME` = JDK 17, Android SDK.
> The build produces per-ABI APKs (arm64/armv7/x86_64) ~88–100 MB.

```bash
cd ~/cipher
export JAVA_HOME=~/Android/jdk-17.0.19+10 ANDROID_HOME=~/Android/Sdk
export PATH=~/.local/node20/bin:$JAVA_HOME/bin:$PATH
npx expo prebuild --clean
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-arm64-v8a-release.apk
adb install -r android/app/build/outputs/apk/release/app-arm64-v8a-release.apk
```

iOS: does **not** build from Linux (needs an Apple account + EAS) — deferred (see the scope table).

### Tests & the "safe to build" gate
```bash
bash scripts/check.sh   # Node 20 + tsc --noEmit + jest --ci + expo export web
```
The gate must be **green** before any release.

---

## Run your own Reticulum gateway

The Reticulum transport routes through a gateway that carries **opaque envelopes only** — it never
sees message content. You can run your own instead of trusting someone else's. See
[`GATEWAY.md`](GATEWAY.md) for the guide and `scripts/run-gateway.sh` to start one.

---

## v1 scope (frozen)

**v1 = secure 1:1 chat on Android.** That's it. Explicitly deferred, behind interfaces,
without blocking v1: WebRTC calls, MLS groups, desktop, iOS, Tor/I2P transport, F-Droid/push
without Google. See `HARDENING_PLAN.md` (Phase 5) for the Definition of Done.

License: **AGPL-3.0**. Vulnerability reporting: private GitHub Security Advisory (see `SECURITY.md`).
