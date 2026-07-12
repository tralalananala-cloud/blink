# Changelog

Toate schimbările notabile ale Blink. Versionare vizibilă userului; formatul mesajelor **1:1**
rămâne compatibil între versiuni — **actualizezi fără reinstalare și fără re-scanare QR**.

## [1.5.0] — 2026-07-12 · Bluetooth: mesaje fără internet

Blink poate livra mesaje **direct de la telefon la telefon, prin Bluetooth**, când destinatarul e
în apropiere. Fără internet, fără releu, fără niciun server. Conținutul rămâne criptat cap-la-cap,
exact ca prin releu — Bluetooth-ul e doar o altă țeavă prin care trece același plic sigilat.

Testat pe două telefoane în mod avion: text, poze și mesaje vocale ajung, cu bifă dublă.

### Adăugat
- **Bluetooth în apropiere (experimental)** — se pornește din Setări → Transport. Când destinatarul
  e în rază, mesajul pleacă prin Bluetooth; dacă nu e, se folosește releul, ca înainte.
- **Rămâi vizibil și cu aplicația închisă** — un serviciu de fundal (cu notificare permanentă) ține
  Bluetooth-ul activ, ca să primești mesaje fără să ții aplicația deschisă. Se poate opri: atunci
  Bluetooth-ul merge doar cât ești în aplicație, iar consumul în buzunar e zero.
- **Transport Reticulum (experimental)** — rutare printr-un gateway Reticulum în loc de releu.

### Schimbat
- **Notificările nu mai arată conținutul mesajului.** Implicit scrie doar „Mesaj nou criptat”, ca
  textul să nu apară pe ecranul blocat. Vrei previzualizarea? O pornești din Setări → Confidențialitate.
- **Pozele și vocea consumă mult mai puțin** — poze în WebP, voce mono la 32 kbps. O poză trimisă
  prin Bluetooth a scăzut de la ~300KB la ~65KB, deci ajunge de câteva ori mai repede.
- Lista de mesaje se deschide la **primul mesaj necitit**, nu la începutul istoricului.

### Reparat
- Mesajele își păstrează **ordinea** când o coadă de așteptare se golește (la reconectare).
- Redarea mesajelor vocale, blocată când aplicația rula în fundal.
- Lista de mesaje sărea la trimitere și rămânea sub tastatură.

### De știut (onest)
- **NU e o rețea mesh.** Mesajul nu sare din telefon în telefon: destinatarul trebuie să fie el
  însuși în raza ta Bluetooth. Nu te baza pe el ca pe o rețea rezistentă la cenzură.
- Cere **v1.5.0 pe ambele telefoane** — nu vorbește cu versiunile mai vechi.
- Raza e cea a Bluetooth-ului: câțiva metri, o cameră.
- **Urmă radio:** cât Bluetooth-ul e pornit, telefonul se anunță cu un identificator stabil. Nu-ți
  dezvăluie identitatea și nu expune mesaje, dar cineva aflat fizic lângă tine, cu un scanner, poate
  observa că **același telefon** trece pe acolo. Detalii în SECURITY.md.
- Bluetooth-ul consumă baterie cât e pornit. Ascultăm în ferestre scurte ca să limităm
  costul, dar nu e gratis.
- După repornirea telefonului, Bluetooth-ul pornește abia când deschizi aplicația o dată.
- Ca și până acum: conversațiile 1:1 rămân compatibile — actualizezi peste, fără re-scanare QR.

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
