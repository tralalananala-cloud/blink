/**
 * Cripto la-repaus a valorilor KV — PUR (doar @noble primitives), fără expo-file-system/SecureStore,
 * deci testabil în jest (vezi __tests__/storageCrypto.test.ts). Folosit de db.ts pt fiecare valoare
 * scrisă pe disc și de stratul SQLite (M1). Format: base64( nonce(12) ‖ ChaCha20-Poly1305(value) ),
 * cheia de 32B dată din afară (în prod = cheia DB din SecureStore/Keystore).
 */
import { aeadDecrypt, aeadEncrypt, concat, fromB64, rand, toB64 } from "../crypto/signal/primitives";

// UTF-8 corect (inclusiv emoji / surrogate pairs) — primitives.utf8 acoperă doar 3 octeți.
export function strToBytes(s: string): Uint8Array {
  const bin = unescape(encodeURIComponent(s));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToStr(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return decodeURIComponent(escape(bin));
}

/** Criptează un string cu cheia dată → base64(nonce ‖ ct). Nonce aleator la fiecare apel. */
export function sealValue(key: Uint8Array, value: string): string {
  const nonce = rand(12);
  const ct = aeadEncrypt(key, nonce, strToBytes(value), new Uint8Array(0));
  return toB64(concat(nonce, ct));
}

/** Decriptează ce a produs sealValue. Aruncă (AEAD) dacă cheia e greșită sau octeții stricați. */
export function openValue(key: Uint8Array, b64: string): string {
  const all = fromB64(b64);
  return bytesToStr(aeadDecrypt(key, all.slice(0, 12), all.slice(12), new Uint8Array(0)));
}
