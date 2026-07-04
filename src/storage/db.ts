/**
 * Bază locală CRIPTATĂ LA REPAUS (Faza 1 — persistență).
 *
 * Magazin cheie→valoare (string) criptat cu ChaCha20-Poly1305; cheia de 32B
 * stă în SecureStore/Keystore (hardware-backed pe Android). Pe disc rămân DOAR
 * octeți criptați — mesajele, sesiunile Double Ratchet și starea app
 * supraviețuiesc reporniri, dar furtul dispozitivului nu dezvăluie nimic.
 *
 * Backend: expo-file-system pe telefon, localStorage pe desktop (Electron/web).
 * Pur-JS (Hermes-safe), fără native module SQLCipher (acela = upgrade Faza 6).
 */
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import { fromB64, rand, toB64 } from "../crypto/signal/primitives";
import { openValue, sealValue } from "./valueCrypto"; // seal/open AEAD PUR, testat (storageCrypto.test.ts)
import { KEYS, secureStorage } from "./secure";

const isWeb = Platform.OS === "web";
const PREFIX = "blink_";

let cachedKey: Uint8Array | null = null;
async function dbKey(): Promise<Uint8Array> {
  if (cachedKey) return cachedKey;
  let b64 = await secureStorage.getSecret(KEYS.dbKey);
  if (!b64) {
    b64 = toB64(rand(32));
    await secureStorage.setSecret(KEYS.dbKey, b64);
  }
  cachedKey = fromB64(b64);
  return cachedKey;
}

function fileUri(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  return (FileSystem.documentDirectory ?? "") + PREFIX + safe;
}

async function readRaw(key: string): Promise<string | null> {
  if (isWeb) {
    try { return window.localStorage.getItem(PREFIX + key); } catch { return null; }
  }
  try {
    const uri = fileUri(key);
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists) return null;
    return await FileSystem.readAsStringAsync(uri);
  } catch { return null; }
}
async function writeRaw(key: string, value: string): Promise<void> {
  if (isWeb) {
    try { window.localStorage.setItem(PREFIX + key, value); } catch {}
    return;
  }
  try { await FileSystem.writeAsStringAsync(fileUri(key), value); } catch {}
}
async function deleteRaw(key: string): Promise<void> {
  if (isWeb) {
    try { window.localStorage.removeItem(PREFIX + key); } catch {}
    return;
  }
  try { await FileSystem.deleteAsync(fileUri(key), { idempotent: true }); } catch {}
}

/** Citește o valoare decriptată (sau null dacă lipsește / nu se poate decripta). */
export async function dbGetItem(key: string): Promise<string | null> {
  const raw = await readRaw(key);
  if (!raw) return null;
  try {
    return openValue(await dbKey(), raw);
  } catch (e) {
    if (typeof __DEV__ !== "undefined" && __DEV__) console.warn("[db] decrypt eșuat pt", key, e);
    return null;
  }
}

/** Scrie o valoare criptată (nonce aleator + AEAD). */
export async function dbSetItem(key: string, value: string): Promise<void> {
  try {
    await writeRaw(key, sealValue(await dbKey(), value));
  } catch (e) {
    if (typeof __DEV__ !== "undefined" && __DEV__) console.warn("[db] scriere eșuată pt", key, e);
  }
}

export async function dbRemoveItem(key: string): Promise<void> {
  await deleteRaw(key);
}

/** M1 — criptează un string → base64(nonce+ct) cu cheia DB (pt rândurile SQLite). */
export async function dbEncryptStr(value: string): Promise<string> {
  return sealValue(await dbKey(), value);
}
/** M1 — decriptează ce a produs dbEncryptStr. */
export async function dbDecryptStr(b64: string): Promise<string> {
  return openValue(await dbKey(), b64);
}

export const DB_KEYS = { store: "store.v1", sessions: "sessions.v1" } as const;
