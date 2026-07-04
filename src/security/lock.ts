/**
 * Parole de blocare — app + per-conversație.
 * Parolele NU se stochează niciodată în clar: ținem doar hash SHA-256 + salt
 * în SecureStore (Keystore). Verificarea re-derivă hash-ul și compară.
 */
import { KEYS, secureStorage } from "../storage/secure";
import { rand, toB64 } from "../crypto/signal/primitives";
import { legacyDigest, verifyDigest } from "./passcode"; // digest+verify PUR, testat (passcode.test.ts)

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
  return verifyDigest(salt, pin, stored); // alege algoritmul după prefix (compat legacy)
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
