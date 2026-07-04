// Push FCM (HTTP v1) — helperi PURI pt JWT service-account → OAuth (Faza 3.4).
// Fără state/fetch: doar crypto.subtle + base64url. Rulează identic în Workers și node → testabil
// (test/push.test.mjs). getAccessToken/pushNotify (cu fetch + cache) rămân în DO (index.js).

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const OAUTH_AUD = "https://oauth2.googleapis.com/token";

/** PEM PKCS#8 (cu \n sau \\n escapat) → ArrayBuffer DER. */
export function pemToArrayBuffer(pem) {
  const clean = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(clean);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

/** Octeți (ArrayBuffer/Uint8Array) → base64url (fără +//=). */
export function b64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** String → base64url. */
export function b64urlStr(s) {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Construiește JWT-ul semnat RS256 pt OAuth service-account (FCM). Pur: importă cheia + semnează
 * cu crypto.subtle. `now` = secunde Unix (injectat pt determinism la test). Întoarce JWT-ul complet.
 */
export async function buildServiceJwt(clientEmail, privateKeyPem, now) {
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64urlStr(JSON.stringify({
    iss: clientEmail, scope: FCM_SCOPE, aud: OAUTH_AUD, iat: now, exp: now + 3600,
  }));
  const unsigned = header + "." + claim;
  const key = await crypto.subtle.importKey(
    "pkcs8", pemToArrayBuffer(privateKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return unsigned + "." + b64url(sig);
}

// ── T4 — anti-furtună de notificări (collapse + notify-once). Puri, testați în test/push_collapse. ──

export const PUSH_NOTIF_TAG = "blink-msg"; // T4.1 — tag de tavă FIX: o notificare nouă O ÎNLOCUIEȘTE pe precedenta

/**
 * Payload FCM: notificare GENERICĂ (zero conținut spre Google) + collapse_key + notification.tag.
 *
 * DE CE tag ȘI collapse_key (fix QA C4 — 3 notificări pt 2 mesaje):
 *  - collapse_key colapsează doar mesajele FCM ÎNCĂ NELIVRATE din coada Google (device offline) —
 *    NU dedupează notificările deja AFIȘATE în tavă. Singur, lăsa un teanc de „Mesaj nou".
 *  - notification.tag = identificator de tavă: fiecare notificare nouă cu același tag O ÎNLOCUIEȘTE
 *    pe precedenta → O SINGURĂ „Mesaj nou criptat", oricâte plicuri ar veni (inclusiv 2 expeditori).
 * Tag CONSTANT, trimis de releu în push (NU pe plicul E2E): payload mereu generic → ZERO scurgere de
 * metadate (respectă „NU tag pe plic"). collapse_key rămâne = DID destinatar.
 */
export function buildPushMessage(token, toDid) {
  return {
    token,
    notification: { title: "Blink", body: "Mesaj nou criptat" },
    android: {
      priority: "high",
      collapse_key: toDid,
      notification: { tag: PUSH_NOTIF_TAG },
    },
  };
}

/**
 * Notify-once-până-online: notifică o SINGURĂ dată per perioadă offline, apoi TACE până revine
 * destinatarul. `alreadyPushed` = flag-ul PERSISTENT `pushed:<DID>` din DO storage (supraviețuiește
 * hibernării WebSocket, spre deosebire de un Map in-memory care se ștergea la fiecare hibernare →
 * de-aceea sunetul se re-alerta la fiecare plic în furtuna de resend-uri media). Flag-ul se șterge
 * la `reg` (clientul a revenit online) → următoarea perioadă offline poate notifica din nou.
 */
export function shouldPush(alreadyPushed) {
  return !alreadyPushed;
}
