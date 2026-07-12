# Blink

> Messenger **end-to-end criptat** — **Android**. Calea implicită e un **releu unic** (Cloudflare)
> care nu poate citi nimic. De la v1.5.0 există și două căi care NU trec prin el, ambele
> experimentale și oprite implicit: **Bluetooth în apropiere** (livrare directă când destinatarul e
> la câțiva metri — NU e mesh, nu există multi-hop) și **Reticulum** (rutare printr-un gateway).
> Descentralizarea reală (multi-releu) rămâne pe roadmap.
> Estetică cypherpunk dark-first. React Native + Expo.

Blink criptează conținutul mesajelor cap-la-cap cu **libsignal** (motorul oficial Signal):
X3DH + Double Ratchet + **PQXDH post-quantum (Kyber / ML-KEM)**. Identitatea ta e o cheie
care trăiește **doar pe dispozitiv** — fără număr de telefon, fără email. Mesajele trec
printr-un releu minimal care **nu le poate citi** (sealed sender: nu vede nici cine trimite).

Fluxul complet (handshake → mesaje text/media/voce → bife → persistență → reconectare) e
**validat E2E pe device** (telefon arm64 ↔ emulator x86_64) prin releul live.

> **Onestitate înainte de marketing.** Integrarea Blink folosește primitive auditate
> (libsignal, @noble/Cure53), dar **integrarea în sine NU a fost auditată independent** și
> rulează doar pe Android. Vezi [Threat model](#threat-model) și [`SECURITY.md`](SECURITY.md).

---

## Ce e și ce NU e

| Livrat & validat pe device | Amânat explicit (scope v1 înghețat) |
|---|---|
| **libsignal** real: X3DH + Double Ratchet + **PQXDH/Kyber** post-quantum | Apeluri audio/video **WebRTC** (cod prezent, netestat fizic) |
| Sealed sender (releul nu vede expeditorul) | Grupuri **MLS** |
| Releu Cloudflare orb + auth challenge-response (Ed25519) | **Desktop** (Electron) — parcat, fără libsignal nativ |
| At-rest (Android): SQLite cu **conținut criptat per-mesaj** (ChaCha20-Poly1305), chei în Keystore; SQLCipher pe tot fișierul = planificat | **iOS** (necesită cont Apple + tuning CocoaPods) |
| Identitate DID:key + frază de recuperare BIP39 + safety number anti-MITM | Transport peste **Tor / I2P**; **multi-hop** pe Bluetooth |
| Text, poze, video, fișiere, note vocale; edit/delete; teme; app-lock + parolă per-conv | F-Droid / push fără Google |
| **Bluetooth în apropiere** + **Reticulum** (experimentale, opt-in) — v1.5.0 | Rotația identificatorului BLE (azi e stabil → urmă radio locală, vezi SECURITY.md) |

**Cheie de design:** tot UI-ul vorbește cu interfața `CryptoEngine` (`src/crypto/types.ts`) —
niciun ecran nu atinge primitive criptografice direct. Există **un singur motor pe sârmă**:
`libsignalEngine.ts` (nativ, Android). Vechiul motor pur-JS (`signalEngine.ts` +
`signal/{x3dh,doubleRatchet}.ts`) a fost **șters** la auditul din 2026-06-24 — era un al
doilea format pe sârmă, incompatibil. Pe web, `crypto/index.ts` întoarce un stub onest
(`UnavailableEngine`); desktopul e parcat.

---

## Arhitectură

```
app/                         # rute (expo-router, file-based)
  _layout.tsx                # fonturi + provideri + garda de securitate
  index.tsx                  # poarta: onboarding vs tabs
  onboarding/                # welcome → identitate → frază → biometrie
  (tabs)/                    # chats / contacts / vault / settings
  chat/[id].tsx              # conversația (prezentational + hooks de stare)
src/
  crypto/      types.ts          # CONTRACTUL motorului (UI vorbește DOAR cu el)
               libsignalEngine.ts # libsignal REAL: PQXDH + Double Ratchet (nativ, Android)
               signal/primitives.ts # wrappere @noble partajate (db/lock/relay)
               index.ts          # libsignal pe nativ, UnavailableEngine pe web
  messaging/   relay.ts          # client WS: connect/bundle/session/send/ack/edit
               codec.ts outbox.ts # codec control + fiabilitate livrare (at-least-once)
  storage/     db.ts             # KV criptat (ChaCha20-Poly1305, cheie în SecureStore)
               messages.ts       # mesaje în SQLite, conținut criptat per-mesaj (write-through O(1)/eveniment)
               secure.ts         # SecureStore (Keystore) + fallback web
  security/    lock.ts           # app-lock + parolă per-conversație
  identity/    did.ts            # DID:key + frază recuperare BIP39 + safety number
  state/       store.ts          # zustand (slices) + persist criptat — ZERO chei private
  i18n/        ro.ts en.ts       # RO + EN
  components/                    # Card, GlowButton, MeshBackground, chat/*, ...
__tests__/                       # crypto pur, identitate, relay wire, store, migrare, ...
```

Releu: `~/cipher-relay/cf-worker` — Cloudflare Worker + Durable Object (`Relay`,
WebSocket Hibernation, storage SQLite). Auth challenge-response, coadă offline at-least-once,
push FCM. Site: `~/cipher-site` → blinkmessenger.vercel.app.

### Decizii de securitate baked-in
- Cheile private / fraza de recuperare trec **doar** prin Android Keystore
  (`expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`). Niciodată AsyncStorage/fișiere simple.
- `state/store.ts` ține doar identitatea **publică** + conversații; zero secrete.
- **DID = `base32(sha256(idKey ‖ authPub))`** — commitment criptografic, verificat la
  stabilirea sesiunii + la releu (un releu compromis nu poate substitui cheia → MITM la
  primul contact blocat criptografic, nu doar prin safety number).
- Fără telemetrie, fără analytics, fără SDK-uri care „sună acasă". Releul e **zero-log**.
- `expo-screen-capture` (anti screenshot/recording) + igienă RAM la fundal.

---

## Threat model

Aliniat cu [`SECURITY.md`](SECURITY.md) (sursa canonică — citește-o pentru detalii).

**Protejăm:**
- **Conținutul mesajelor** — E2EE prin libsignal (X3DH + PQXDH + Double Ratchet). Releul nu citește.
- **Identitate fără PII** — cheie pe dispozitiv (DID:key), fără telefon/email. Recuperare BIP39.
- **Anti-MITM** — safety number (SHA-256 peste ambele chei reale) + verificare QR + alertă la schimbare de cheie + binding DID↔cheie.
- **Sealed sender** — releul nu vede CINE trimite (doar destinatarul, pentru rutare).
- **La repaus (Android)** — chei în Keystore; mesaje în SQLite cu conținut criptat per-mesaj (ChaCha20-Poly1305). SQLCipher pe tot fișierul = planificat; timestamp-ul de index rămâne în clar.

**NU protejăm (limitări asumate):**
- **Metadate de rețea** — releul (Cloudflare) vede **IP, timing, volum**. Sealed sender
  ascunde DID-ul expeditorului, NU calea de rețea. Tor/I2P = pe roadmap, nelivrat.
- **Impersonare pe contacte NEVERIFICATE** — plicul sealed nu autentifică expeditorul la
  nivel exterior (`sd` auto-declarat); autenticitatea reală vine din interior (mesajul
  libsignal se decriptează doar sub sesiunea corectă) + safety number. Pe un contact nou,
  verifică safety number-ul.
- **Dispozitiv compromis** — root/keylogger/malware înfrânge orice messenger.
- **Neauditat independent** — primitivele sunt auditate, integrarea Blink nu.
- **Doar Android** — desktopul (Electron) e parcat; pe el secretele ar sta în localStorage
  necriptat. Calea sigură e Android.

---

## Build (Android)

> Necesită **Node 20** (Expo SDK 52 nu merge pe Node nou). `JAVA_HOME` = JDK 17, Android SDK.
> Build-ul produce APK-uri per-ABI (arm64/armv7/x86_64) ~88–100 MB.

```bash
cd ~/cipher
export JAVA_HOME=~/Android/jdk-17.0.19+10 ANDROID_HOME=~/Android/Sdk
export PATH=~/.local/node20/bin:$JAVA_HOME/bin:$PATH
npx expo prebuild --clean
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-arm64-v8a-release.apk
adb install -r android/app/build/outputs/apk/release/app-arm64-v8a-release.apk
```

iOS: **nu** se compilează de pe Linux (necesită cont Apple + EAS) — amânat (vezi tabelul de scope).

### Teste & poarta „safe to build"
```bash
bash scripts/check.sh   # Node 20 + tsc --noEmit + jest --ci + expo export web
```
Poarta trebuie să fie **verde** înainte de orice release.

---

## Scope v1 (înghețat)

**v1 = chat 1:1 securizat pe Android.** Atât. Amânate explicit, în spatele interfețelor,
fără a bloca v1: apeluri WebRTC, grupuri MLS, desktop, iOS, transport Tor/I2P/Reticulum,
F-Droid/push fără Google. Vezi `HARDENING_PLAN.md` (Faza 5) pentru Definition of Done.

Licență: **AGPL-3.0**. Raportare vulnerabilități: GitHub Security Advisory privat (vezi `SECURITY.md`).
