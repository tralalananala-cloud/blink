/**
 * Faza 2.3 — migrare idempotentă a mesajelor din blobul zustand vechi → SQLite.
 * Codul trăiește în hydrateMessages (store.ts): prima rulare (flag `migrated` absent) mută
 * mesajele deja-hidratate din blob în SQLite + setează flag-ul; rulările următoare încarcă din
 * SQLite, fără re-migrare. Mock-uim repo-ul + flag-ul stateful și verificăm că migrarea rulează
 * O SINGURĂ DATĂ și că istoricul rămâne intact „peste update".
 */
export {}; // fișier-modul (folosește require, nu import) — izolează scope-ul de celelalte teste

jest.mock("expo-crypto", () => ({
  getRandomValues: (arr: any) => require("crypto").webcrypto.getRandomValues(arr),
}));
jest.mock("react-native", () => ({ AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) } }));
jest.mock("../src/notify", () => ({ notifyMessage: jest.fn() }));
jest.mock("../src/transport/mockTransport", () => ({ transport: { setMode: jest.fn() } }));
jest.mock("../src/storage/db", () => ({
  dbGetItem: jest.fn(async () => null), dbSetItem: jest.fn(), dbRemoveItem: jest.fn(),
  DB_KEYS: { store: "store.v1", sessions: "sessions.v1" },
}));

// „SQLite" simulat + flag de migrare stateful (setMigrated îl comută → isMigrated întoarce true)
const mockMig = { v: false };
const mockSqlite: Record<string, any[]> = {};
const mockRepo = {
  MESSAGES_IN_DB: true,
  appendMessage: jest.fn(async (convId: string, m: any) => { (mockSqlite[convId] ||= []).push(m); }),
  updateMessage: jest.fn(async () => {}),
  setMessageStatus: jest.fn(async () => {}),
  deleteMessage: jest.fn(async () => {}),
  deleteConvMessages: jest.fn(async () => {}),
  syncConv: jest.fn(async (convId: string, msgs: any[]) => { mockSqlite[convId] = msgs.slice(); }),
  loadAllMessages: jest.fn(async () => JSON.parse(JSON.stringify(mockSqlite))),
  wipeMessages: jest.fn(async () => {}),
  isMigrated: jest.fn(async () => mockMig.v),
  setMigrated: jest.fn(async () => { mockMig.v = true; }),
};
jest.mock("../src/storage/messages", () => mockRepo);

// require (NU import) — altfel import-ul s-ar hoist-ui deasupra `const mockRepo`.
const { useApp, hydrateMessages } = require("../src/state/store");

it("prima rulare: migrează istoricul din blob în SQLite + setează flag-ul", async () => {
  mockMig.v = false;
  for (const k of Object.keys(mockSqlite)) delete mockSqlite[k];
  jest.clearAllMocks();

  await hydrateMessages();

  expect(mockRepo.syncConv).toHaveBeenCalled();        // mesajele seed (cu istoric) → SQLite
  expect(mockRepo.setMigrated).toHaveBeenCalled();     // flag pus → nu se mai repetă
  expect(mockRepo.loadAllMessages).not.toHaveBeenCalled(); // prima rulare NU citește din SQLite
  const total = Object.values(mockSqlite).reduce((n, m) => n + m.length, 0);
  expect(total).toBeGreaterThan(0);                    // chiar s-a migrat ceva
});

it("a doua rulare: idempotent — NU re-migrează, încarcă din SQLite", async () => {
  mockMig.v = true; // deja migrat
  for (const k of Object.keys(mockSqlite)) delete mockSqlite[k];
  mockSqlite["ion"] = [{ id: "ion-0", text: "istoric vechi", fromMe: false, ts: 1, status: "received" }];
  jest.clearAllMocks();

  await hydrateMessages();

  expect(mockRepo.syncConv).not.toHaveBeenCalled();    // FĂRĂ re-migrare
  expect(mockRepo.setMigrated).not.toHaveBeenCalled();
  expect(mockRepo.loadAllMessages).toHaveBeenCalled(); // încarcă din SQLite
  // istoricul din SQLite ajunge în state (intact peste „update")
  const ion = useApp.getState().conversations.find((c: any) => c.id === "ion");
  expect(ion.messages.some((m: any) => m.id === "ion-0" && m.text === "istoric vechi")).toBe(true);
});

it("merge defensiv: mesajele sosite în fereastra de pornire NU se pierd + se re-persistă", async () => {
  mockMig.v = true;
  for (const k of Object.keys(mockSqlite)) delete mockSqlite[k];
  mockSqlite["ion"] = [{ id: "ion-db", text: "din DB", fromMe: false, ts: 1, status: "received" }];
  // simulează un mesaj sosit înainte ca hydrate să termine (doar în state, nu în SQLite)
  useApp.setState((s: any) => ({
    conversations: s.conversations.map((c: any) =>
      c.id === "ion" ? { ...c, messages: [{ id: "ion-live", text: "sosit la pornire", fromMe: false, ts: 2, status: "received" }] } : c),
  }));
  jest.clearAllMocks();

  await hydrateMessages();

  const ion = useApp.getState().conversations.find((c: any) => c.id === "ion");
  const ids = ion.messages.map((m: any) => m.id);
  expect(ids).toContain("ion-db");    // din SQLite
  expect(ids).toContain("ion-live");  // sosit la pornire — păstrat
  // extra-ul (ion-live) e re-persistat în SQLite (flush extras) → nu se pierde la următorul restart
  expect(mockRepo.appendMessage).toHaveBeenCalledWith("ion", expect.objectContaining({ id: "ion-live" }));
});
