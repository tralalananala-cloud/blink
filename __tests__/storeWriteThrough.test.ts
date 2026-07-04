/**
 * Faza 2.2 — write-through O(1): fiecare mutație de mesaj din store.ts trebuie să scrie DOAR
 * rândul atins prin messageRepository (nu să rescrie toată conversația). Mock-uim mockRepo-ul cu
 * spioni și verificăm că reducerele cheamă operația corectă + că guard-ul anti-pierdere
 * (suspendMsgSync via clearMessagesFromMemory) chiar oprește scrierile cât RAM-ul e golit.
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
// mockRepo mock-uit cu spioni — inima testului
const mockRepo = {
  MESSAGES_IN_DB: true,
  appendMessage: jest.fn(async () => {}),
  updateMessage: jest.fn(async () => {}),
  setMessageStatus: jest.fn(async () => {}),
  deleteMessage: jest.fn(async () => {}),
  deleteConvMessages: jest.fn(async () => {}),
  syncConv: jest.fn(async () => {}),
  loadAllMessages: jest.fn(async () => ({})),
  wipeMessages: jest.fn(async () => {}),
  isMigrated: jest.fn(async () => true),
  setMigrated: jest.fn(async () => {}),
};
jest.mock("../src/storage/messages", () => mockRepo);

// require (NU import) — import-ul s-ar hoist-ui deasupra `const mockRepo` → mock-ul ar returna
// undefined la încărcarea store.ts (MESSAGES_IN_DB undefined).
const { useApp, hydrateMessages } = require("../src/state/store");

const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
const DID = "did:key:z6MkTestPeerAAAAAAAAAAAA";

async function freshConv(did = DID) {
  const id = useApp.getState().openDirect({ name: "Peer", did, verified: false, status: "relay" } as any);
  return id;
}

beforeAll(async () => {
  await hydrateMessages(); // isMigrated=true → loadAllMessages={} → messagesReady=true (scrierile active)
});
beforeEach(() => {
  jest.clearAllMocks();
  mockRepo.loadAllMessages.mockResolvedValue({});
  mockRepo.isMigrated.mockResolvedValue(true);
});

describe("scrieri O(1) — reducerele cheamă operația de rând corectă", () => {
  it("appendMessage → mockRepo.appendMessage(convId, mesaj)", async () => {
    const cid = await freshConv("did:key:z6MkAppendAAAAAAAAAAAAAAA");
    const id = useApp.getState().appendMessage(cid, "salut 🔐", true);
    await flush();
    expect(mockRepo.appendMessage).toHaveBeenCalledTimes(1);
    const [convArg, msgArg] = mockRepo.appendMessage.mock.calls[0] as any;
    expect(convArg).toBe(cid);
    expect(msgArg).toMatchObject({ id, text: "salut 🔐", fromMe: true });
    expect(mockRepo.syncConv).not.toHaveBeenCalled(); // NU rescrie toată conversația
  });

  it("markMsgStatus → mockRepo.setMessageStatus(convId, id, status) (un singur rând)", async () => {
    const did = "did:key:z6MkStatusAAAAAAAAAAAAAA";
    const cid = await freshConv(did);
    const id = useApp.getState().appendMessage(cid, "hi", true); // status iniţial "sending"
    await flush();
    jest.clearAllMocks();
    useApp.getState().markMsgStatus(did, id, "delivered");
    await flush();
    expect(mockRepo.setMessageStatus).toHaveBeenCalledWith(cid, id, "delivered");
  });

  it("editMessage → mockRepo.updateMessage", async () => {
    const cid = await freshConv("did:key:z6MkEditAAAAAAAAAAAAAAAA");
    const id = useApp.getState().appendMessage(cid, "v1", true);
    await flush(); jest.clearAllMocks();
    useApp.getState().editMessage(cid, id, "v2");
    await flush();
    expect(mockRepo.updateMessage).toHaveBeenCalledWith(cid, id, expect.any(Function));
  });

  it("deleteMessage → mockRepo.deleteMessage(id)", async () => {
    const cid = await freshConv("did:key:z6MkDelMsgAAAAAAAAAAAAA");
    const id = useApp.getState().appendMessage(cid, "de șters", true);
    await flush(); jest.clearAllMocks();
    useApp.getState().deleteMessage(cid, id);
    await flush();
    expect(mockRepo.deleteMessage).toHaveBeenCalledWith(id);
  });

  it("deleteConversation → mockRepo.deleteConvMessages(convId)", async () => {
    const cid = await freshConv("did:key:z6MkDelConvAAAAAAAAAAAA");
    jest.clearAllMocks();
    useApp.getState().deleteConversation(cid);
    await flush();
    expect(mockRepo.deleteConvMessages).toHaveBeenCalledWith(cid);
  });

  it("applyRemoteDelete → mockRepo.deleteMessage(localId) (mapează remoteId→id local)", async () => {
    const did = "did:key:z6MkRemoteDelAAAAAAAAAA";
    const cid = await freshConv(did);
    const localId = useApp.getState().appendMessage(cid, "primit", false, undefined, { remoteId: "R1" });
    await flush(); jest.clearAllMocks();
    useApp.getState().applyRemoteDelete(did, "R1");
    await flush();
    expect(mockRepo.deleteMessage).toHaveBeenCalledWith(localId);
  });
});

describe("guard anti-pierdere — suspendMsgSync oprește scrierile (igienă RAM)", () => {
  it("după clearMessagesFromMemory, append NU se persistă; deblocarea reactivează", async () => {
    const cid = await freshConv("did:key:z6MkSuspendAAAAAAAAAAAA");
    useApp.getState().clearMessagesFromMemory(); // suspendMsgSync = true
    useApp.getState().appendMessage(cid, "în fereastra blocată", true);
    await flush();
    expect(mockRepo.appendMessage).not.toHaveBeenCalled(); // gated — rămâne în state, re-persistat la hydrate

    await hydrateMessages(); // deblocare → suspendMsgSync=false, scrierile re-active
    jest.clearAllMocks();
    useApp.getState().appendMessage(cid, "după deblocare", true);
    await flush();
    expect(mockRepo.appendMessage).toHaveBeenCalledTimes(1);
  });
});

// QA C4 (batch stabilitate) — necitite corecte când coada offline re-livrează resend-uri.
describe("necitite — dedupe remoteId nu umflă contorul (fix C4)", () => {
  it("același remoteId livrat de 3 ori (resend din coadă) → un mesaj, unread = 1", async () => {
    const did = "did:key:z6MkUnreadDupAAAAAAAAAAA";
    useApp.getState().receiveMessage(did, "buna", "RID1");
    useApp.getState().receiveMessage(did, "buna", "RID1"); // resend
    useApp.getState().receiveMessage(did, "buna", "RID1"); // resend
    await flush();
    const conv = useApp.getState().conversations.find((c: any) => c.did === did) as any;
    expect(conv.messages.filter((m: any) => !m.fromMe).length).toBe(1); // deduplicat
    expect(conv.unread).toBe(1); // NU 3 — garda pe increment
  });

  it("mesaje distincte incrementează necititele normal", async () => {
    const did = "did:key:z6MkUnreadTwoAAAAAAAAAAA";
    useApp.getState().receiveMessage(did, "unu", "RID_A");
    useApp.getState().receiveMessage(did, "doi", "RID_B");
    await flush();
    const conv = useApp.getState().conversations.find((c: any) => c.did === did) as any;
    expect(conv.unread).toBe(2);
  });
});
