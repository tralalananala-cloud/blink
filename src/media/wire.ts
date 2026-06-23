/**
 * Transfer media prin rețea (Faza 3) — citește/scrie fișiere ca base64.
 *
 * Fișierul e citit local → base64 → trimis pe bucăți criptate E2E prin releu →
 * reasamblat la destinatar → scris într-un fișier local (file://) ca să-l poată
 * reda <Image>/<Video>/<Audio>. Pe desktop (web) folosim data: URL.
 *
 * Niciun octet nu pleacă necriptat: bucățile trec prin ratchet (vezi relay.ts).
 */
import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import type { File as FileT } from "expo-file-system/next"; // doar tipuri (modul nativ → lazy)
import { AttachmentKind } from "../data/mockData";
import { fromB64, toB64 } from "../crypto/signal/primitives";

const isWeb = Platform.OS === "web";

/** Plafon: peste atât, refuzăm. 8MB = sigur pt memoria telefonului (transfer inline base64
 *  în RAM). Peste asta → OutOfMemoryError pe telefon. Video mare = nevoie de streaming/blob (Faza 6). */
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
/** Mărimea unei bucăți de base64 trimise printr-un mesaj ratchet. */
export const CHUNK_B64 = 48 * 1024;
/** M4 — aceeași bucată exprimată în OCTEȚI (36864 = CHUNK_B64*3/4, divizibil cu 3 →
 *  base64 fără padding intermediar). Calea de streaming și cea legacy produc bucăți
 *  identice ca limite de octeți, deci formatul de pe sârmă e compatibil. */
export const CHUNK_BYTES = (CHUNK_B64 * 3) / 4;

const EXT: Record<AttachmentKind, string> = {
  image: "jpg", video: "mp4", voice: "m4a", circle: "mp4", file: "bin",
};

function extFor(kind: AttachmentKind, name?: string, mime?: string): string {
  const fromName = name && name.includes(".") ? name.split(".").pop()! : "";
  if (fromName) return fromName.toLowerCase().slice(0, 5);
  if (mime && mime.includes("/")) return mime.split("/")[1].slice(0, 5);
  return EXT[kind] ?? "bin";
}

function mimeFor(kind: AttachmentKind, ext: string): string {
  if (kind === "image") return ext === "png" ? "image/png" : "image/jpeg";
  if (kind === "video" || kind === "circle") return "video/mp4";
  if (kind === "voice") return ext === "mp3" ? "audio/mpeg" : "audio/mp4";
  return "application/octet-stream";
}

/** Citește un fișier local ca base64 (sau null dacă nu reușește / e prea mare). */
export async function readBase64(uri: string): Promise<{ b64: string; bytes: number } | null> {
  try {
    if (isWeb) {
      const res = await fetch(uri);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > MAX_MEDIA_BYTES) return null;
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      return { b64: typeof btoa !== "undefined" ? btoa(bin) : "", bytes: buf.length };
    }
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists && info.size && info.size > MAX_MEDIA_BYTES) return null;
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return { b64, bytes: info.exists && info.size ? info.size : Math.floor((b64.length * 3) / 4) };
  } catch {
    return null;
  }
}

/** Scrie media primită într-un fișier local și întoarce uri-ul de redare. */
export async function writeMedia(id: string, kind: AttachmentKind, name: string | undefined, b64: string): Promise<string> {
  const ext = extFor(kind, name);
  const mime = mimeFor(kind, ext);
  if (isWeb) {
    // Pe desktop/web: blob URL (NU data: URL) — altfel <Video> nu redă video/cerculețe.
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([bytes], { type: mime }));
    } catch {
      return `data:${mime};base64,${b64}`;
    }
  }
  const dir = FileSystem.documentDirectory + "media/";
  try { await FileSystem.makeDirectoryAsync(dir, { intermediates: true }); } catch {}
  const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "_");
  const uri = `${dir}${safeId}.${ext}`;
  await FileSystem.writeAsStringAsync(uri, b64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

export function splitChunks(b64: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < b64.length; i += CHUNK_B64) out.push(b64.slice(i, i + CHUNK_B64));
  return out;
}

// ─── M4: TRANSFER MEDIA STREAMING (fără a ține tot fișierul în RAM) ───────────

/**
 * Citește fișierul pe bucăți și cheamă `onChunk(b64, i, total)` pentru fiecare —
 * pe NATIV prin FileHandle (peak RAM ≈ o bucată, ~36KB), cu fallback legacy
 * (citește tot → felii) pe web/Expo Go sau dacă API-ul nativ nu e disponibil.
 */
export async function streamFileChunks(
  uri: string,
  onChunk: (b64: string, index: number, total: number) => Promise<void>,
): Promise<{ bytes: number; chunks: number } | null> {
  if (Platform.OS !== "web") {
    const { File } = require("expo-file-system/next"); // lazy (modul nativ)
    let handle: ReturnType<FileT["open"]> | null = null;
    let size = 0;
    let total = 0;
    try {
      const f = new File(uri);
      size = f.size ?? 0;
      if (size > MAX_MEDIA_BYTES) return null; // prea mare — refuză (nu fallback)
      if (!size) throw new Error("no-size"); // dimensiune necunoscută → fallback legacy
      total = Math.ceil(size / CHUNK_BYTES);
      handle = f.open();
    } catch {
      return legacyStream(uri, onChunk); // DOAR erori de deschidere → fallback
    }
    if (!handle) return legacyStream(uri, onChunk);
    // de aici erorile (citire/trimitere) PROPAGĂ — am început deja transferul, nu reluăm
    try {
      for (let i = 0; i < total; i++) await onChunk(toB64(handle.readBytes(CHUNK_BYTES)), i, total);
    } finally {
      handle.close();
    }
    return { bytes: size, chunks: total };
  }
  return legacyStream(uri, onChunk);
}

async function legacyStream(
  uri: string,
  onChunk: (b64: string, index: number, total: number) => Promise<void>,
): Promise<{ bytes: number; chunks: number } | null> {
  const read = await readBase64(uri);
  if (!read) return null;
  const total = Math.max(1, Math.ceil(read.b64.length / CHUNK_B64));
  for (let i = 0; i < total; i++) await onChunk(read.b64.slice(i * CHUNK_B64, (i + 1) * CHUNK_B64), i, total);
  return { bytes: read.bytes, chunks: total };
}

/** Destinație de scriere incrementală a media primite (streaming la recepție). */
export interface MediaSink {
  writeChunk(index: number, b64: string): void;
  finish(): string; // întoarce uri-ul final de redare
  abort(): void;
}

/**
 * Creează un sink nativ care scrie fiecare bucată DIRECT în fișier (seek la
 * index*CHUNK_BYTES → robust la dezordine), fără array de bucăți + join în RAM.
 * Întoarce null pe web/Expo Go sau dacă API-ul nativ lipsește → caller-ul cade pe
 * asamblarea legacy în memorie.
 */
export function createMediaSink(id: string, kind: AttachmentKind, name?: string): MediaSink | null {
  if (Platform.OS === "web") return null;
  try {
    const { Directory, File, Paths } = require("expo-file-system/next"); // lazy (modul nativ)
    const ext = extFor(kind, name);
    const dir = new Directory(Paths.document, "media");
    if (!dir.exists) dir.create();
    const safeId = id.replace(/[^a-zA-Z0-9._-]/g, "_");
    const file = new File(dir, `${safeId}.${ext}`);
    if (file.exists) file.delete();
    file.create();
    const handle = file.open();
    return {
      writeChunk(index, b64) {
        handle.offset = index * CHUNK_BYTES; // seek la poziția bucății
        handle.writeBytes(fromB64(b64));
      },
      finish() { handle.close(); return file.uri; },
      abort() { try { handle.close(); } catch {} try { file.delete(); } catch {} },
    };
  } catch {
    return null;
  }
}
