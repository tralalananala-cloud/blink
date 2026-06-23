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
import { aeadDecrypt, aeadEncrypt, concat, fromB64, rand, toB64 } from "../crypto/signal/primitives";
import { KEYS, secureStorage } from "./secure";

const isWeb = Platform.OS === "web";
const PREFIX = "blink_";

// UTF-8 corect (inclusiv emoji / surrogate pairs) — primitives.utf8 acoperă doar 3 octeți.
function strToBytes(s: string): Uint8Array {
  const bin = unescape(encodeURIComponent(s));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToStr(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return decodeURIComponent(escape(bin));
}

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
    const k = await dbKey();
    const all = fromB64(raw);
    const nonce = all.slice(0, 12);
    const ct = all.slice(12);
    return bytesToStr(aeadDecrypt(k, nonce, ct, new Uint8Array(0)));
  } catch (e) {
    if (typeof __DEV__ !== "undefined" && __DEV__) console.warn("[db] decrypt eșuat pt", key, e);
    return null;
  }
}

/** Scrie o valoare criptată (nonce aleator + AEAD). */
export async function dbSetItem(key: string, value: string): Promise<void> {
  try {
    const k = await dbKey();
    const nonce = rand(12);
    const ct = aeadEncrypt(k, nonce, strToBytes(value), new Uint8Array(0));
    await writeRaw(key, toB64(concat(nonce, ct)));
  } catch (e) {
    if (typeof __DEV__ !== "undefined" && __DEV__) console.warn("[db] scriere eșuată pt", key, e);
  }
}

export async function dbRemoveItem(key: string): Promise<void> {
  await deleteRaw(key);
}

/** M1 — criptează un string → base64(nonce+ct) cu cheia DB (pt rândurile SQLite). */
export async function dbEncryptStr(value: string): Promise<string> {
  const k = await dbKey();
  const nonce = rand(12);
  const ct = aeadEncrypt(k, nonce, strToBytes(value), new Uint8Array(0));
  return toB64(concat(nonce, ct));
}
/** M1 — decriptează ce a produs dbEncryptStr. */
export async function dbDecryptStr(b64: string): Promise<string> {
  const k = await dbKey();
  const all = fromB64(b64);
  return bytesToStr(aeadDecrypt(k, all.slice(0, 12), all.slice(12), new Uint8Array(0)));
}

export const DB_KEYS = { store: "store.v1", sessions: "sessions.v1" } as const;
