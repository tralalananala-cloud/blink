# Blink — Securitate & Threat Model

> Onest înainte de toate: spunem ce protejăm **și ce NU**. Blink folosește primitive
> auditate (libsignal, @noble/Cure53), dar **integrarea noastră nu a fost auditată
> independent**. Nu afișăm „AUDITED".

## Ce protejează Blink
- **Conținutul mesajelor** — E2EE prin **libsignal** (X3DH + **PQXDH post-quantum / Kyber-ML-KEM** + Double Ratchet). Releul nu poate citi mesajele.
- **Identitate fără PII** — cheie pe dispozitiv (DID:key), fără număr de telefon/email. Frază de recuperare BIP39.
- **Anti-MITM** — safety number (SHA-256 peste ambele chei reale) + verificare QR + alertă la schimbarea cheii.
- **Sealed sender** — releul nu vede CINE trimite (doar destinatarul, pentru rutare).
- **La repaus (Android)** — chei în Keystore (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`); mesaje în SQLite cu **conținut criptat per-mesaj** (ChaCha20-Poly1305). Criptarea SQLCipher pe **tot fișierul** = planificată; metadatele de index (timestamp) rămân în clar. Pe web/desktop: storage local criptat, nu SQLite.
- **Pe dispozitiv** — lock app (parolă **scrypt** + biometrie), parolă per-conversație, mesaje care dispar, anti-screenshot, igienă RAM la fundal.

## Ce NU protejează (limitări asumate)
- **Metadate de rețea** — releul (Cloudflare) vede **IP-ul, timing-ul și volumul** tău. Sealed sender ascunde DID-ul expeditorului, NU calea de rețea. Tor = pe roadmap.
- **Push (FCM)** — cu notificări active (app închis), releul stochează maparea **DID→token FCM**; Google (FCM) vede **token↔timing**, releul vede **DID↔token**. Conținutul rămâne E2EE (push-ul e doar un semnal „ai un mesaj", fără text). Fără push activat → **zero implicare Google**.
- **Impersonare pe contacte NEVERIFICATE (sealed sender)** — plicul sealed nu autentifică criptografic expeditorul la nivel **exterior** (`sd` e auto-declarat). Autenticitatea reală vine din **interior**: mesajul libsignal se decriptează DOAR sub sesiunea lui `sd`, deci un `sd` fals eșuează la decriptare. În plus, de la auditul 2026-06-24 **DID-ul = sha256(idKey ‖ authPub)** și e verificat la stabilirea sesiunii + la releu → un releu **nu mai poate substitui cheia** (MITM la primul contact e blocat criptografic, nu doar prin safety number). Reziduu: pe un contact pe care nu l-ai adăugat niciodată, tot verifici safety number-ul. [audit #2/#6]
- **Dispozitiv compromis** — root/malware/keylogger înfrânge orice messenger. Protejăm conținutul, nu un OS ostil.
- **Desktop (Electron) la repaus** — pe desktop secretele stau în `localStorage` (necriptat de OS) → criptarea „at rest" e slabă fără full-disk encryption. Android e calea sigură; desktopul e parcat. [audit #3]
- **Neauditat** — primitivele sunt auditate, integrarea Blink nu. Plan: open-source + reproducible builds + bug bounty.

## Rezultatul auditului intern (2026-06-22)
**Reparat:** badge fals „AUDITED" scos (`isAudited=false`); cod mort cu hash necriptografic șters; comparație parolă în timp constant; releu cu **rate-limit + cap coadă** anti-spam + logging redus de DID-uri.

**Parolă app (#4) — nuanță:** scrypt pur-JS blochează firul UI pe telefon (Hermes) câteva secunde → am revenit la SHA-256 rapid. Pe Android hash-ul e protejat de Android Keystore, deci e acceptabil. Un KDF lent real (anti brute-force pe hash extras, relevant mai ales pe desktop) cere un modul nativ — **amânat**.

**Documentat / pe roadmap:** #3 plaintext desktop (desktop parcat), #8 bias minor de modulo la afișarea safety number (neglijabil), #12 AEAD fără AAD pe stocarea locală (schimbarea ar invalida datele existente).

## Rezultatul auditului 2026-06-24 (focus Android/libsignal)
Motorul vechi `SignalEngine` (pur-JS, al doilea format pe sârmă) a fost **ȘTERS** — rămâne un singur motor: **libsignal** nativ. Reparat în acest val:
- **C1 — Auth releu (challenge-response).** Releul cerea zero dovadă de proprietate a DID-ului → oricine putea drena coada altuia, suprascrie bundle-ul, face dereg sau seta push token. Acum reg-ul **semnează un nonce** cu o cheie Ed25519 derivată din seed; releul verifică semnătura + `did === base32(sha256(idKey ‖ authPub))` cu WebCrypto. `reg/dereg/push/qack` cer autentificare; `getbundle/send` rămân deschise (sealed = anonim by design).
- **C2 — Binding DID↔cheie.** La stabilirea sesiunii, clientul verifică `didFrom(idKey, authPub) === peerDid` → un releu compromis nu mai poate substitui cheia la primul contact.
- **#7 — DID = hash, nu trunchiere.** `base32(sha256(idKey ‖ authPub))`, non-lossy, ~200 biți → commitment criptografic real (înlocuiește trunchierea base64 lossy).
- **#4 — One-time prekeys reale.** Pool de prekey-uri (id-uri monotone) ținut de releu și **POPat câte unul per `getbundle`** → fiecare contact primește un opk diferit; fix și pt bug-ul „al doilea contact nu putea iniția sesiune". Prekey last-resort reutilizabil ca fallback; signed prekey rotit la 7 zile.
- **#5/#7 — Anti-replay & banner.** Dedupe LRU pe amprenta plicului (replay/re-livrare ignorate) + bannerul „re-pair" se ridică doar pt contacte cu sesiune existentă, debounce 30s (nu mai poate fi spamat).

> ⚠️ Modificările pe motorul libsignal sunt type-correct + cross-verificate în Node, dar necesită **test E2E pe device** înainte de release. Format pe sârmă nou (DID + authPub + auth releu) → **toți re-pairează** (QR).

## Raportare vulnerabilități
După publicarea sursei: GitHub Security Advisory privat pe repo-ul Blink. Disclosure coordonat, fără acțiuni legale împotriva cercetării de bună-credință.
