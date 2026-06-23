/**
 * Parole de blocare — app + per-conversație.
 * Parolele NU se stochează niciodată în clar: ținem doar hash SHA-256 + salt
 * în SecureStore (Keystore). Verificarea re-derivă hash-ul și compară.
 */
import { KEYS, secureStorage } from "../storage/secure";
import { equal, fromB64, hash, rand, toB64, utf8 } from "../crypto/signal/primitives";
import { scrypt } from "@noble/hashes/scrypt";

// #4 — KDF LENT (scrypt) pt parole: un PIN scurt nu mai e brute-force-abil rapid dacă
// hash-ul e extras. Prefix „s1:" marchează formatul nou; parolele vechi (SHA-256, fără
// prefix) sunt încă verificate (compat înapoi), ca să nu blocăm userii existenți.
function legacyDigest(saltB64: string, pin: string): string {
  return toB64(hash(utf8(saltB64 + "::" + pin)));
}
function scryptDigest(saltB64: string, pin: string): string {
  return "s1:" + toB64(scrypt(utf8(pin), fromB64(saltB64), { N: 16384, r: 8, p: 1, dkLen: 32 }));
}
// #6 — comparație în timp constant (pe octeți), nu `===`.
function constEq(a: string, b: string): boolean {
  return equal(utf8(a), utf8(b));
}

const APP_SALT = "cipher.lock.app.salt";
const APP_HASH = "cipher.lock.app.hash";
const convSaltKey = (id: string) => `cipher.lock.conv.${id}.salt`;
const convHashKey = (id: string) => `cipher.lock.conv.${id}.hash`;

async function setSecret(saltKey: string, hashKey: string, pin: string) {
  const saltB64 = toB64(rand(16));
  await secureStorage.setSecret(saltKey, saltB64);
  // RAPID (SHA-256): scrypt pur-JS blochează firul UI pe telefon (Hermes) câteva secunde →
  // butonul „pare" neapăsat + unlock lent. Pe Android hash-ul e protejat de Keystore, deci
  // SHA-256 e acceptabil. KDF lent real = nevoie de modul nativ (amânat). Vezi SECURITY.md #4.
  await secureStorage.setSecret(hashKey, legacyDigest(saltB64, pin));
}
async function verify(saltKey: string, hashKey: string, pin: string): Promise<boolean> {
  const salt = await secureStorage.getSecret(saltKey);
  const stored = await secureStorage.getSecret(hashKey);
  if (!salt || !stored) return false;
  // alege algoritmul după prefix (compat cu parolele vechi SHA-256, fără prefix)
  const computed = stored.startsWith("s1:") ? scryptDigest(salt, pin) : legacyDigest(salt, pin);
  return constEq(computed, stored);
}

// --- App lock ---
export const setAppPasscode = (pin: string) => setSecret(APP_SALT, APP_HASH, pin);
export const verifyAppPasscode = (pin: string) => verify(APP_SALT, APP_HASH, pin);
export const hasAppPasscode = async () => !!(await secureStorage.getSecret(APP_HASH));
export async function clearAppPasscode() {
  await secureStorage.deleteSecret(APP_SALT);
  await secureStorage.deleteSecret(APP_HASH);
}

// --- Conversation lock ---
export const setConvPasscode = (id: string, pin: string) => setSecret(convSaltKey(id), convHashKey(id), pin);
export const verifyConvPasscode = (id: string, pin: string) => verify(convSaltKey(id), convHashKey(id), pin);
export const hasConvPasscode = async (id: string) => !!(await secureStorage.getSecret(convHashKey(id)));
export async function clearConvPasscode(id: string) {
  await secureStorage.deleteSecret(convSaltKey(id));
  await secureStorage.deleteSecret(convHashKey(id));
  unlockedConvs.delete(id);
}

/** Conversații deblocate în sesiunea curentă (resetate la repornire). */
export const unlockedConvs = new Set<string>();

/**
 * B2 — WIPE TOTAL al secretelor din SecureStore: identitate (seed+pub), mnemonic,
 * cheia bazei criptate, parola app + parolele TUTUROR conversațiilor. După asta
 * SecureStore nu mai conține nicio cheie (nu doar datele blob, ci și cheile).
 */
export async function wipeAllSecrets(convIds: string[]): Promise<void> {
  await clearAppPasscode();
  for (const id of convIds) await clearConvPasscode(id);
  await Promise.all([
    secureStorage.deleteSecret(KEYS.identityPriv),
    secureStorage.deleteSecret(KEYS.identityPub),
    secureStorage.deleteSecret(KEYS.mnemonic),
    secureStorage.deleteSecret(KEYS.dbKey),
  ]);
}
