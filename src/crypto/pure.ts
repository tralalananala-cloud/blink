/**
 * Helperi cripto PURI extrași din libsignalEngine — fără nicio dependență nativă
 * (react-native-libsignal-client), deci testabili în jest/node (vezi __tests__/cryptoPure.test.ts).
 * Operează doar pe octeți; partea NATIVĂ (ECDH agree, signalEncrypt/Decrypt, generarea cheilor)
 * rămâne în libsignalEngine și se validează E2E pe device.
 *
 * Conțin: codecul UTF-8 al motorului, safety number-ul anti-MITM și plicul sealed-sender
 * (#2 metadate) — framing + AEAD box peste un secret partajat ECDH dat din afară.
 */
import {
  toB64, fromB64, hash, hkdfBytes, aeadEncrypt, aeadDecrypt, rand, concat, utf8, fromUtf8,
} from "./signal/primitives";

// UTF-8 corect (emoji) fără a depinde de TextEncoder (absent în unele runtime-uri).
export function enc(s: string): Uint8Array {
  const bin = unescape(encodeURIComponent(s));
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
export function dec(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return decodeURIComponent(escape(bin));
}

/**
 * Safety number = fingerprint comun al celor două identități, pt verificare anti-MITM
 * (compari codul cu prietenul față-în-față / pe alt canal). Determinist + SIMETRIC:
 * sortăm cele două chei publice canonical, hash iterat (anti-precomputare), 60 cifre.
 * Identic pe ambele capete DOAR dacă fiecare deține cheia reală a celuilalt.
 */
export function safetyDigits(a: Uint8Array, b: Uint8Array): string {
  const [x, y] = toB64(a) < toB64(b) ? [a, b] : [b, a];
  let h = hash(new Uint8Array([...x, ...y]));
  for (let i = 0; i < 16; i++) h = hash(h);
  let digits = "";
  for (let i = 0; i < 60; i++) digits += (h[i % h.length] % 10).toString();
  return digits.match(/.{1,5}/g)!.join(" ");
}

// ── Sealed sender (#2 metadate): plic ECDH box ───────────────────────────────
// Format blob: [ephLen(1)] [ephPub] [nonce(12)] [ciphertext]. Cheia AEAD = HKDF(shared).
// `shared` = secretul ECDH (X25519) calculat NATIV de apelant (eph.agree(peerPub) /
// myKey.agree(ephPub)); aici doar derivăm cheia + AEAD + framing.
const SEALED_INFO = "blink-sealed-v1";

/** Conținutul interior al plicului: did expeditor + tipul + mesajul libsignal (base64). */
export interface SealedPayload { sd: string; t: number; c: string }

/** Sigilează payload-ul către un secret partajat dat → octeții blob-ului (apelantul îi face base64). */
export function sealBox(shared: Uint8Array, ephPub: Uint8Array, payload: SealedPayload): Uint8Array {
  const key = hkdfBytes(shared, new Uint8Array(0), SEALED_INFO, 32);
  const nonce = rand(12);
  const ct = aeadEncrypt(key, nonce, utf8(JSON.stringify(payload)), new Uint8Array(0));
  return concat(new Uint8Array([ephPub.length]), ephPub, nonce, ct);
}

/** Cheia publică efemeră din antetul blob-ului (necesară pt a calcula `shared` înainte de open). */
export function readEphPub(blob: Uint8Array): Uint8Array {
  const ephLen = blob[0];
  return blob.slice(1, 1 + ephLen);
}

/**
 * Deschide plicul cu secretul partajat dat → payload-ul. Gardă #6: respinge un `sd` malformat
 * înainte de a-l folosi (autenticitatea REALĂ vine de la libsignal — mesajul interior se
 * decriptează doar sub sesiunea lui `sd`). AEAD aruncă dacă cheia/octeții nu se potrivesc.
 */
export function openBox(shared: Uint8Array, blob: Uint8Array): SealedPayload {
  const ephLen = blob[0];
  const nonce = blob.slice(1 + ephLen, 1 + ephLen + 12);
  const ct = blob.slice(1 + ephLen + 12);
  const key = hkdfBytes(shared, new Uint8Array(0), SEALED_INFO, 32);
  const payload = JSON.parse(fromUtf8(aeadDecrypt(key, nonce, ct, new Uint8Array(0))));
  const sd = payload?.sd;
  if (typeof sd !== "string" || !/^did:key:z[A-Za-z0-9]{16,}$/.test(sd)) {
    throw new Error("sealed: expeditor (sd) invalid");
  }
  return payload as SealedPayload;
}

// re-export util folosit de apelanți (decriptare blob base64 → octeți), ca să nu importe separat
export { toB64, fromB64 };
