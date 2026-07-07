# Changelog

Toate schimbările notabile ale Blink. Versionare vizibilă userului; formatul mesajelor **1:1**
rămâne compatibil între versiuni — **actualizezi fără reinstalare și fără re-scanare QR**.

## [1.4.0] — 2026-07-07 · Grupuri

Blink are grupuri, cu **exact aceeași criptare ca la 1:1**. Nu e o cheie de grup nouă și
neverificată: fiecare mesaj de grup pleacă **cifrat individual (libsignal) către fiecare membru**
— aceleași garanții pe care le ai deja în conversațiile față-în-față.

### Adăugat
- **Grupuri criptate cap-la-cap.** Creezi un grup, adaugi membri din contacte, scrii text și
  trimiți poze — totul E2EE. Pe fiecare mesaj vezi cine l-a trimis. Bifa **✓✓** apare când
  **toți** membrii au confirmat primirea.
- **Administrare grup.** Creatorul e admin: adaugă și scoate membri. Oricine poate **părăsi**
  grupul; ceilalți sunt anunțați, iar istoricul rămâne pe dispozitivul tău.

### Onestitate
- **Nu e „descentralizat" și releul vede volumul.** Un mesaj de grup = N trimiteri 1:1 prin
  releul orb. Releul **nu vede conținutul** (e cifrat), dar vede că ai trimis N plicuri — adică
  **cât de mare e grupul**, nu ce scrii. Onest față de metadate.
- **Toți membrii au nevoie de v1.4+.** Formatul de grup e nou. Un prieten pe o versiune mai
  veche **nu poate participa** la grup — îi va apărea mesajul greșit (ca text tehnic într-o
  conversație separată). Trimite-le linkul de actualizare înainte să-i adaugi.
- **Fără MLS, fără chei de grup.** Am ales fan-out 1:1 tocmai ca să nu introducem criptografie
  nouă. Compromisul: e eficient pentru grupuri mici (până la 16 membri), nu pentru sute.

### Note
- **1:1 rămâne fără re-pair.** Conversațiile față-în-față folosesc același format ca înainte —
  actualizezi peste versiunea veche, îți păstrezi identitatea și conversațiile. Doar **grupurile**
  cer ca toți să fie pe v1.4+.

## [1.2.2] — 2026-07-04 · Stabilitate 1:1

Un lot dedicat stabilității unei conversații 1:1: notificări calme, poze mai rapide și fără
scurgere de locație, ștergere la ambii și zero butoane moarte. Fără schimbări pe rețea →
**update fără re-pair**.

### Îmbunătățit
- **Notificări calme.** Cu app-ul închis, primești **o singură** notificare „Mesaj nou
  criptat", nu un teanc — indiferent câte mesaje sau bucăți de poză sosesc, și de la oricâți
  expeditori. Sunetul te anunță o dată, nu în buclă. (Conținutul e tot acolo când deschizi.)
- **Poze mai rapide și fără locație.** Pozele sunt redimensionate automat înainte de trimitere
  (o poză de câțiva MB pleacă în ~200 KB) și **re-encodate**, ceea ce **șterge complet datele
  EXIF, inclusiv GPS-ul** — nu-ți mai scapă locația către destinatar. O poză mare nu mai
  blochează textele trimise imediat după ea.
- **Contor de necitite corect.** La revenirea online după o pauză, mesajele re-livrate din
  coadă nu mai umflă numărul de necitite — vezi exact câte mesaje noi ai.

### Adăugat
- **Șterge conversația la ambii.** În opțiunile conversației poți goli conversația și la tine,
  și la celălalt. Onest: **cooperativ, nu garantat** — un contact cu backup, screenshot sau
  client modificat poate păstra mesajele.
- **Ghid pentru notificări cu app-ul închis (Android).** La prima pornire, un pas te ajută să
  activezi „Autostart" și „Fără restricții de baterie" pe telefoanele care opresc agresiv
  aplicațiile în fundal (OPPO/ColorOS, Xiaomi, Huawei). E o limită a producătorului, nu a
  Blink — la fel cer Signal și WhatsApp.

### Schimbat
- **Apelurile voce/video sunt ascunse temporar.** Funcția n-a fost testată suficient pe
  dispozitive reale; preferăm să n-o arătăm până merge sigur, în loc de un buton care nu
  răspunde. Revine într-o versiune viitoare.

### Note
- **Fără re-pair:** formatul mesajelor pe rețea e neschimbat. Actualizezi peste versiunea
  anterioară și îți păstrezi identitatea și conversațiile — fără reinstalare, fără QR nou.
