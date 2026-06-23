/**
 * Primitive criptografice AUDITATE (@noble, audit Cure53). NU le implementăm noi.
 * Aici doar le împachetăm în funcții cu nume clare pentru protocolul Signal.
 *
 *   X25519  — Diffie-Hellman          (@noble/curves)
 *   Ed25519 — semnături pe prekey-uri  (@noble/curves)
 *   HKDF/HMAC-SHA256 — KDF chains      (@noble/hashes)
 *   ChaCha20-Poly1305 — AEAD           (@noble/ciphers)
 */
import "../random"; // polyfill getRandomValues ÎNAINTE de @noble
import { x25519, ed25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
import { randomBytes } from "@noble/hashes/utils";
import { chacha20poly1305 } from "@noble/ciphers/chacha";

export type Bytes = Uint8Array;

export interface KeyPair {
  priv: Bytes;
  pub: Bytes;
}

export const rand = (n: number): Bytes => randomBytes(n);

// --- X25519 (DH) ---
export function genDH(): KeyPair {
  const priv = x25519.utils.randomPrivateKey();
  return { priv, pub: x25519.getPublicKey(priv) };
}
export function dh(priv: Bytes, pub: Bytes): Bytes {
  return x25519.getSharedSecret(priv, pub);
}

// --- Ed25519 (semnături) ---
export function genSign(): KeyPair {
  const priv = ed25519.utils.randomPrivateKey();
  return { priv, pub: ed25519.getPublicKey(priv) };
}
export const sign = (priv: Bytes, msg: Bytes): Bytes => ed25519.sign(msg, priv);
export const verify = (sig: Bytes, msg: Bytes, pub: Bytes): boolean => ed25519.verify(sig, msg, pub);

// --- KDF-uri ---
export function hkdfBytes(ikm: Bytes, salt: Bytes, info: string, len: number): Bytes {
  return hkdf(sha256, ikm, salt, utf8(info), len);
}
export function hmacSha256(key: Bytes, msg: Bytes): Bytes {
  return hmac(sha256, key, msg);
}
export const hash = (msg: Bytes): Bytes => sha256(msg);

// --- AEAD (ChaCha20-Poly1305) ---
export function aeadEncrypt(key: Bytes, nonce: Bytes, plaintext: Bytes, aad: Bytes): Bytes {
  return chacha20poly1305(key, nonce, aad).encrypt(plaintext);
}
export function aeadDecrypt(key: Bytes, nonce: Bytes, ct: Bytes, aad: Bytes): Bytes {
  return chacha20poly1305(key, nonce, aad).decrypt(ct);
}

// --- utilitare bytes <-> string/base64 ---
export function utf8(s: string): Bytes {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}
export function fromUtf8(b: Bytes): string {
  let out = "";
  let i = 0;
  while (i < b.length) {
    const c = b[i++];
    if (c < 0x80) out += String.fromCharCode(c);
    else if (c < 0xe0) out += String.fromCharCode(((c & 0x1f) << 6) | (b[i++] & 0x3f));
    else out += String.fromCharCode(((c & 0x0f) << 12) | ((b[i++] & 0x3f) << 6) | (b[i++] & 0x3f));
  }
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function toB64(b: Bytes): string {
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const a = b[i], c = i + 1 < b.length ? b[i + 1] : 0, d = i + 2 < b.length ? b[i + 2] : 0;
    out += B64[a >> 2] + B64[((a & 3) << 4) | (c >> 4)] + (i + 1 < b.length ? B64[((c & 15) << 2) | (d >> 6)] : "=") + (i + 2 < b.length ? B64[d & 63] : "=");
  }
  return out;
}
export function fromB64(s: string): Bytes {
  const clean = s.replace(/=+$/, "");
  const out: number[] = [];
  let buf = 0, bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
  }
  return new Uint8Array(out);
}

export function concat(...arrs: Bytes[]): Bytes {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

export function equal(a: Bytes, b: Bytes): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
