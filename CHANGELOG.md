# Changelog

Toate schimbările notabile ale Blink. Versionare vizibilă userului; formatul mesajelor pe
rețea rămâne compatibil între versiuni — **actualizezi fără reinstalare și fără re-scanare QR**.

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
