/**
 * Faza 2.1 — messageRepository (src/storage/messages.ts) peste expo-sqlite.
 * expo-sqlite e NATIV (nu rulează în jest), deci rulăm codul REAL al repository-ului peste
 * un FAKE SQLite in-memory care recunoaște exact interogările folosite. Cripto (dbEncryptStr/
 * dbDecryptStr) e REALĂ (valueCrypto + cheie fixă mock-uită) → testăm și că rândurile chiar
 * se cifrează/decifrează, ordonarea pe ts, paginarea (cursor `before` + limit) și operațiile O(1).
 */
jest.mock("expo-crypto", () => ({
  getRandomValues: (arr: any) => require("crypto").webcrypto.getRandomValues(arr),
}));
jest.mock("react-native", () => ({ Platform: { OS: "android" } }));      // NU web → repo-ul lucrează
jest.mock("expo-file-system", () => ({ documentDirectory: "file:///" })); // importat de db.ts, nefolosit aici
// cheie DB fixă (32B) → dbEncryptStr/dbDecryptStr reale, deterministe pt test
const mockDbKey = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
jest.mock("../src/storage/secure", () => ({
  KEYS: { dbKey: "cipher.db.key" },
  secureStorage: { getSecret: jest.fn(async () => mockDbKey), setSecret: jest.fn(), deleteSecret: jest.fn() },
}));

// ── FAKE SQLite in-memory: interpretează exact interogările repository-ului ──
type Row = { id: string; conv_id: string; ts: number; blob: string };
let rows: Row[] = [];
const meta: Record<string, string> = {};
const mockFakeDb = {
  async execAsync(sql: string) {
    if (sql.includes("DELETE FROM messages")) rows = [];
    if (sql.includes("DELETE FROM meta")) for (const k of Object.keys(meta)) delete meta[k];
    // PRAGMA / CREATE TABLE / CREATE INDEX → no-op
  },
  async runAsync(sql: string, params: any[] = []) {
    if (sql.includes("INSERT OR REPLACE INTO messages")) {
      const [id, conv_id, ts, blob] = params;
      rows = rows.filter((r) => r.id !== id);
      rows.push({ id, conv_id, ts, blob });
    } else if (sql.includes("DELETE FROM messages WHERE conv_id")) {
      rows = rows.filter((r) => r.conv_id !== params[0]);
    } else if (sql.includes("DELETE FROM messages WHERE id")) {
      rows = rows.filter((r) => r.id !== params[0]);
    } else if (sql.includes("INSERT OR REPLACE INTO meta")) {
      meta["migrated"] = "1";
    }
    return { changes: 0, lastInsertRowId: 0 };
  },
  async getAllAsync(sql: string, params: any[] = []) {
    let res = rows.slice();
    if (sql.includes("WHERE conv_id")) res = res.filter((r) => r.conv_id === params[0]);
    if (sql.includes("ts <")) { const before = params[1]; res = res.filter((r) => r.ts < before); }
    res.sort((a, b) => (sql.includes("DESC") ? b.ts - a.ts : a.ts - b.ts));
    if (sql.includes("LIMIT")) res = res.slice(0, params[params.length - 1]);
    return res.map((r) => ({ conv_id: r.conv_id, blob: r.blob }));
  },
  async getFirstAsync(sql: string, params: any[] = []) {
    if (sql.includes("COUNT(*)")) {
      const res = sql.includes("WHERE conv_id") ? rows.filter((r) => r.conv_id === params[0]) : rows;
      return { n: res.length };
    }
    if (sql.includes("FROM messages WHERE id")) {
      const r = rows.find((x) => x.id === params[0]);
      return r ? { blob: r.blob } : null;
    }
    if (sql.includes("FROM meta")) return meta["migrated"] != null ? { v: meta["migrated"] } : null;
    return null;
  },
  async withTransactionAsync(fn: () => Promise<void>) { await fn(); },
};
jest.mock("expo-sqlite", () => ({ openDatabaseAsync: jest.fn(async () => mockFakeDb) }));

import {
  appendMessage, updateMessage, setMessageStatus, deleteMessage, getPage, countMessages, syncConv,
} from "../src/storage/messages";
import type { Message, MsgStatus } from "../src/data/mockData";

const msg = (id: string, ts: number, over: Partial<Message> = {}): Message => ({
  id, text: "m" + id, fromMe: true, ts, status: "sent" as MsgStatus, ...over,
});

beforeEach(() => { rows = []; for (const k of Object.keys(meta)) delete meta[k]; });

describe("appendMessage — O(1) upsert", () => {
  it("adaugă un mesaj recuperabil prin getPage (cifrat în blob)", async () => {
    await appendMessage("c1", msg("a", 100));
    expect(rows).toHaveLength(1);
    expect(rows[0].blob).not.toContain("ma"); // conținutul e cifrat, nu plaintext
    const page = await getPage("c1");
    expect(page.map((m) => m.id)).toEqual(["a"]);
    expect(page[0].text).toBe("ma");
  });

  it("upsert pe id (același id → înlocuiește, nu dublează)", async () => {
    await appendMessage("c1", msg("a", 100, { text: "v1" }));
    await appendMessage("c1", msg("a", 100, { text: "v2" }));
    expect(rows).toHaveLength(1);
    expect((await getPage("c1"))[0].text).toBe("v2");
  });
});

describe("getPage — ordonare + paginare", () => {
  beforeEach(async () => {
    // inserate în dezordine — repo-ul trebuie să le ordoneze pe ts
    for (const [id, ts] of [["b", 200], ["a", 100], ["d", 400], ["c", 300]] as [string, number][]) {
      await appendMessage("c1", msg(id, ts));
    }
    await appendMessage("c2", msg("x", 999)); // altă conversație — izolare
  });

  it("întoarce ASC pe ts, doar din conversația cerută", async () => {
    expect((await getPage("c1")).map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
    expect((await getPage("c2")).map((m) => m.id)).toEqual(["x"]);
  });

  it("limit → cele mai RECENTE N (dar întoarse ASC)", async () => {
    expect((await getPage("c1", { limit: 2 })).map((m) => m.id)).toEqual(["c", "d"]);
  });

  it("cursor `before` → pagina anterioară (scroll în sus)", async () => {
    // cele mai recente 2 = c,d; pagina următoare mai veche decât c(300)
    expect((await getPage("c1", { before: 300, limit: 2 })).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("conversație goală → []", async () => {
    expect(await getPage("inexistent")).toEqual([]);
  });
});

describe("updateMessage / setMessageStatus — O(1), un singur rând", () => {
  it("setMessageStatus schimbă doar statusul mesajului țintă", async () => {
    await appendMessage("c1", msg("a", 100, { status: "sent" }));
    await appendMessage("c1", msg("b", 200, { status: "sent" }));
    await setMessageStatus("c1", "a", "read");
    const page = await getPage("c1");
    expect(page.find((m) => m.id === "a")!.status).toBe("read");
    expect(page.find((m) => m.id === "b")!.status).toBe("sent"); // neatins
    expect(rows).toHaveLength(2); // fără dublări
  });

  it("updateMessage pe id inexistent → no-op (nu creează rând)", async () => {
    await updateMessage("c1", "fantoma", (m) => ({ ...m, text: "x" }));
    expect(rows).toHaveLength(0);
  });

  it("updateMessage aplică mutația și păstrează id-ul", async () => {
    await appendMessage("c1", msg("a", 100, { edited: false }));
    await updateMessage("c1", "a", (m) => ({ ...m, text: "editat", edited: true }));
    const m = (await getPage("c1"))[0];
    expect(m.text).toBe("editat");
    expect(m.edited).toBe(true);
  });
});

describe("deleteMessage / countMessages", () => {
  it("deleteMessage scoate un singur mesaj", async () => {
    await appendMessage("c1", msg("a", 100));
    await appendMessage("c1", msg("b", 200));
    await deleteMessage("a");
    expect((await getPage("c1")).map((m) => m.id)).toEqual(["b"]);
  });

  it("countMessages numără pe conversație fără a încărca", async () => {
    await appendMessage("c1", msg("a", 100));
    await appendMessage("c1", msg("b", 200));
    await appendMessage("c2", msg("c", 300));
    expect(await countMessages("c1")).toBe(2);
    expect(await countMessages("c2")).toBe(1);
    expect(await countMessages("c3")).toBe(0);
  });
});

describe("compatibilitate cu syncConv existent (rescriere O(conv))", () => {
  it("syncConv apoi getPage citește aceleași mesaje (același tabel/blob)", async () => {
    await syncConv("c1", [msg("a", 100), msg("b", 200)] as any);
    expect((await getPage("c1")).map((m) => m.id)).toEqual(["a", "b"]);
  });
});
