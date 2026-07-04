/**
 * M1 — stocarea mesajelor în SQLite (expo-sqlite), separat de blobul zustand.
 *
 * De ce: înainte, ORICE schimbare (un mesaj, o bifă ✓→✓✓) reserializa + recripta
 * ÎNTREG istoricul tuturor conversațiilor (blob unic) → suprasolicita RAM-ul/CPU-ul.
 * Acum: scriem doar conversația atinsă, rând cu rând, indexat pe (conv_id, ts).
 *
 * Conținutul mesajului e criptat la nivel de APLICAȚIE (ChaCha20-Poly1305 cu
 * `dbKey`-ul din SecureStore, ca în storage/db.ts). Metadatele (ts) rămân plaintext
 * în DB pentru index/ordonare — SQLCipher pt criptarea întregului fișier = mai târziu.
 *
 * Doar pe NATIV. Pe web/desktop modulul e no-op (mesajele rămân în blobul zustand).
 */
import { Platform } from "react-native";
import type * as SQLiteT from "expo-sqlite"; // doar tipuri — modulul nativ se încarcă lazy
import { Message, MsgStatus } from "../data/mockData";
import { dbEncryptStr, dbDecryptStr } from "./db";

const isWeb = Platform.OS === "web";
// M1 REACTIVAT 2026-06-21 (Etapa 3): bug-ul de pierdere la restart era write-through-ul
// care sincroniza array GOL peste SQLite în fereastra de pornire (înainte ca hydrateMessages
// să reîncarce) ȘI la golirea RAM. Fix în store.ts: guard-urile `messagesReady`/`suspendMsgSync`
// + merge defensiv la hidratare. Mesajele stau rând-cu-rând în SQLite (criptate app-layer),
// blobul zustand nu le mai re-serializează la fiecare bifă. Doar nativ; web/desktop = blob.
export const MESSAGES_IN_DB = true;

let dbp: Promise<SQLiteT.SQLiteDatabase> | null = null;

async function db(): Promise<SQLiteT.SQLiteDatabase> {
  if (!dbp) {
    dbp = (async () => {
      // require lazy: expo-sqlite e modul NATIV → nu-l încărca pe web/Electron
      const SQLite = require("expo-sqlite") as typeof SQLiteT;
      const d = await SQLite.openDatabaseAsync("blink-messages.db");
      await d.execAsync(
        "PRAGMA journal_mode = WAL;" +
        "CREATE TABLE IF NOT EXISTS messages (" +
        "  id TEXT PRIMARY KEY, conv_id TEXT NOT NULL, ts INTEGER NOT NULL, blob TEXT NOT NULL);" +
        "CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conv_id, ts);" +
        "CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);"
      );
      return d;
    })();
  }
  return dbp;
}

/** Sincronizează TOATE mesajele unei conversații (DELETE+INSERT în tranzacție). O(conv). */
export async function syncConv(convId: string, messages: Message[]): Promise<void> {
  if (isWeb) return;
  try {
    const d = await db();
    await d.withTransactionAsync(async () => {
      await d.runAsync("DELETE FROM messages WHERE conv_id = ?", [convId]);
      for (const m of messages) {
        const blob = await dbEncryptStr(JSON.stringify(m));
        await d.runAsync(
          "INSERT OR REPLACE INTO messages (id, conv_id, ts, blob) VALUES (?, ?, ?, ?)",
          [m.id, convId, m.ts ?? 0, blob],
        );
      }
    });
  } catch { /* best-effort: pe eroare, blobul zustand rămâne sursa de rezervă */ }
}

// ─── messageRepository: operații O(1) / paginate (Faza 2.1) ──────────────────
// syncConv de mai sus rescrie ÎNTREAGA conversație (re-criptează tot istoricul la fiecare
// bifă) = O(conv). Funcțiile de mai jos ating UN SINGUR rând per eveniment = O(1), iar getPage
// citește paginat+indexat (nu tot în RAM). store.ts va comuta pe ele în 2.2/2.4 (gate device).

/** O(1): adaugă sau înlocuiește un singur mesaj (upsert pe id). */
export async function appendMessage(convId: string, m: Message): Promise<void> {
  if (isWeb) return;
  try {
    const d = await db();
    const blob = await dbEncryptStr(JSON.stringify(m));
    await d.runAsync(
      "INSERT OR REPLACE INTO messages (id, conv_id, ts, blob) VALUES (?, ?, ?, ?)",
      [m.id, convId, m.ts ?? 0, blob],
    );
  } catch { /* best-effort */ }
}

/** O(1): citește-modifică-scrie UN mesaj existent (edit, bifă) — nu atinge restul conversației. */
export async function updateMessage(convId: string, id: string, mutate: (m: Message) => Message): Promise<void> {
  if (isWeb) return;
  try {
    const d = await db();
    const row = await d.getFirstAsync<{ blob: string }>("SELECT blob FROM messages WHERE id = ?", [id]);
    if (!row) return;
    const next = mutate(JSON.parse(await dbDecryptStr(row.blob)) as Message);
    await appendMessage(convId, next);
  } catch { /* best-effort */ }
}

/** O(1): schimbă statusul unui mesaj (✓→✓✓) fără a rescrie/recripta toată conversația. */
export function setMessageStatus(convId: string, id: string, status: MsgStatus): Promise<void> {
  return updateMessage(convId, id, (m) => ({ ...m, status }));
}

/** O(1): șterge un singur mesaj. */
export async function deleteMessage(id: string): Promise<void> {
  if (isWeb) return;
  try { const d = await db(); await d.runAsync("DELETE FROM messages WHERE id = ?", [id]); } catch {}
}

/**
 * Pagină de mesaje pt afișare: cele mai recente `limit`, mai vechi decât `before` (cursor pe ts)
 * dacă e dat → încărcare la scroll în sus. Întoarce ASC pe ts (ordine de afișare). Indexat,
 * NU încarcă tot istoricul în RAM (vs loadAllMessages). Faza 2.4 = FlatList virtualizat peste asta.
 */
export async function getPage(convId: string, opts?: { before?: number; limit?: number }): Promise<Message[]> {
  if (isWeb) return [];
  const limit = opts?.limit ?? 50;
  try {
    const d = await db();
    const rows = opts?.before != null
      ? await d.getAllAsync<{ blob: string }>(
          "SELECT blob FROM messages WHERE conv_id = ? AND ts < ? ORDER BY ts DESC LIMIT ?", [convId, opts.before, limit])
      : await d.getAllAsync<{ blob: string }>(
          "SELECT blob FROM messages WHERE conv_id = ? ORDER BY ts DESC LIMIT ?", [convId, limit]);
    const out: Message[] = [];
    for (const r of rows) { try { out.push(JSON.parse(await dbDecryptStr(r.blob)) as Message); } catch { /* rând corupt */ } }
    return out.reverse(); // DESC (recente întâi) → ASC pt afișare cronologică
  } catch { return []; }
}

/** Câte mesaje are o conversație (pt „mai sus" / contoare), fără a le încărca. */
export async function countMessages(convId: string): Promise<number> {
  if (isWeb) return 0;
  try {
    const d = await db();
    const r = await d.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE conv_id = ?", [convId]);
    return r?.n ?? 0;
  } catch { return 0; }
}

/** Șterge toate mesajele unei conversații (la ștergerea conversației). */
export async function deleteConvMessages(convId: string): Promise<void> {
  if (isWeb) return;
  try { const d = await db(); await d.runAsync("DELETE FROM messages WHERE conv_id = ?", [convId]); } catch {}
}

/** Încarcă toate mesajele, grupate pe conversație (la pornire). */
export async function loadAllMessages(): Promise<Record<string, Message[]>> {
  if (isWeb) return {};
  try {
    const d = await db();
    const rows = await d.getAllAsync<{ conv_id: string; blob: string }>(
      "SELECT conv_id, blob FROM messages ORDER BY ts ASC",
    );
    const out: Record<string, Message[]> = {};
    for (const r of rows) {
      try {
        const m = JSON.parse(await dbDecryptStr(r.blob)) as Message;
        (out[r.conv_id] ||= []).push(m);
      } catch { /* rând corupt — sări */ }
    }
    return out;
  } catch { return {}; }
}

/** Golește tot (la wipe). */
export async function wipeMessages(): Promise<void> {
  if (isWeb) return;
  try { const d = await db(); await d.execAsync("DELETE FROM messages; DELETE FROM meta;"); } catch {}
}

/** Flag de migrare one-time (din blobul vechi în SQLite). */
export async function isMigrated(): Promise<boolean> {
  if (isWeb) return true;
  try { const d = await db(); const r = await d.getFirstAsync<{ v: string }>("SELECT v FROM meta WHERE k = 'migrated'"); return r?.v === "1"; } catch { return false; }
}
export async function setMigrated(): Promise<void> {
  if (isWeb) return;
  try { const d = await db(); await d.runAsync("INSERT OR REPLACE INTO meta (k, v) VALUES ('migrated', '1')"); } catch {}
}
