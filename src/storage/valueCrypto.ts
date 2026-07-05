/**
 * Cripto la-repaus a valorilor KV — PUR (doar @noble primitives), fără expo-file-system/SecureStore,
 * deci testabil în jest (vezi __tests__/storageCrypto.test.ts). Folosit de db.ts pt fiecare valoare
 * scrisă pe disc și de stratul SQLite (M1). Format: base64( nonce(12) ‖ ChaCha20-Poly1305(value) ),
 * cheia de 32B dată din afară (în prod = cheia DB din SecureStore/Keystore).
 */
import { aeadDecrypt, aeadEncrypt, concat, fromB64, rand, toB64 } from "../crypto/signal/primitives";

// UTF-8 corect (inclusiv emoji / surrogate pairs) prin TextEncoder/TextDecoder (D3).
// Pt UTF-8 valid = EXACT aceiași octeți ca vechiul unescape(encodeURIComponent(...)) →
// valorile KV / rândurile SQLite scrise ÎNAINTE se decriptează identic după schimbare
// (dovadă: __tests__/codecCompat.test.ts). ignoreBOM:true păstrează un U+FEFF de la început.
const _te = new TextEncoder();
const _td = new TextDecoder("utf-8", { ignoreBOM: true });
export function strToBytes(s: string): Uint8Array {
  return _te.encode(s);
}
export function bytesToStr(b: Uint8Array): string {
  return _td.decode(b);
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
