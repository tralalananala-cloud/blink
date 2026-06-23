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
import { Message } from "../data/mockData";
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
