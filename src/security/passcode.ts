/**
 * Logica PURĂ de parolă (digest + verificare) — fără SecureStore, testabilă în jest
 * (vezi __tests__/passcode.test.ts). Parolele NU se stochează în clar; ținem doar un
 * digest peste salt+pin. Prefix „s1:" = scrypt (KDF lent #4); fără prefix = SHA-256 legacy
 * (compat înapoi pt parolele deja setate). lock.ts pune SecureStore în jurul acestor funcții.
 */
import { equal, fromB64, hash, toB64, utf8 } from "../crypto/signal/primitives";
import { scrypt } from "@noble/hashes/scrypt";

/** Digest RAPID (SHA-256 peste salt+pin) — format legacy, fără prefix. */
export function legacyDigest(saltB64: string, pin: string): string {
  return toB64(hash(utf8(saltB64 + "::" + pin)));
}

/** Digest LENT (scrypt, #4) — brute-force costisitor dacă hash-ul e extras. Prefix „s1:". */
export function scryptDigest(saltB64: string, pin: string): string {
  return "s1:" + toB64(scrypt(utf8(pin), fromB64(saltB64), { N: 16384, r: 8, p: 1, dkLen: 32 }));
}

/** Comparație în timp constant (pe octeți), nu `===` — #6 anti timing-leak. */
export function constEq(a: string, b: string): boolean {
  return equal(utf8(a), utf8(b));
}

/**
 * Verifică `pin` față de un digest stocat, alegând algoritmul după prefix:
 * „s1:" → scrypt, altfel → SHA-256 legacy. Întoarce false dacă nu se potrivește.
 */
export function verifyDigest(saltB64: string, pin: string, stored: string): boolean {
  const computed = stored.startsWith("s1:") ? scryptDigest(saltB64, pin) : legacyDigest(saltB64, pin);
  return constEq(computed, stored);
}
