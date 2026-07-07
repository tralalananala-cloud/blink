/**
 * Lot GRUPURI v1 (G2) — starea de grup în chatSlice: creare cu roster real (gid, admin=eu),
 * recepție gt cu auto-creare conversație + sender pe mesaj + dedupe pe (remoteId, sender),
 * membership prin gc (create/add/remove doar admin, leave oricine), bife de grup.
 * Același harness ca storeWriteThrough (mock repo SQLite + require, nu import).
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

const { useApp, hydrateMessages } = require("../src/state/store");
const { notifyMessage } = require("../src/notify");

const ME = "did:key:z6MkMeMeMeMeMeMeMeMeMeMe";
const ANA = "did:key:z6MkAnaAnaAnaAnaAnaAnaAn";
const BOB = "did:key:z6MkBobBobBobBobBobBobBo";

const st = () => useApp.getState();
const conv = (gid: string) => st().conversations.find((c: any) => c.id === gid);

beforeAll(async () => {
  await hydrateMessages();
  st().setIdentity({ did: ME } as any);
});
beforeEach(() => jest.clearAllMocks());

describe("createGroup — roster real", () => {
  it("gid = id-ul conversației, eu sunt admin și în roster, fără duplicate", () => {
    const gid = st().createGroup("Gașca", [ANA, BOB, ANA]);
    const c = conv(gid);
    expect(gid.startsWith("g_")).toBe(true);
    expect(c.group).toBe(true);
    expect(c.admin).toBe(ME);
    expect(c.members).toEqual([ME, ANA, BOB]);
    expect(c.did).toBe(gid); // fără DID fals did:key:zGroup
  });
  it("roster tăiat la GROUP_MAX", () => {
    const many = Array.from({ length: 30 }, (_, i) => `did:key:z6MkM${i}`);
    const gid = st().createGroup("Mare", many);
    expect(conv(gid).members.length).toBe(16);
  });
});

describe("receiveGroupMessage — recepție gt", () => {
  it("grup necunoscut → auto-creare cu gname + expeditor în roster; mesajul are sender", () => {
    st().receiveGroupMessage(ANA, "g_x1", "salut grup", "r1", undefined, "Ana", "Gașca X");
    const c = conv("g_x1");
    expect(c).toBeTruthy();
    expect(c.name).toBe("Gașca X");
    expect(c.members).toEqual([ANA]);
    expect(c.unread).toBe(1);
    const m = c.messages[0];
    expect(m.sender).toBe(ANA);
    expect(m.senderName).toBe("Ana");
    expect(m.fromMe).toBe(false);
  });
  it("dedupe pe (remoteId, sender): resend nu dublează, alt sender cu același remoteId NU e dedupat", () => {
    st().receiveGroupMessage(ANA, "g_x2", "unu", "rid", undefined, "Ana", "G");
    st().receiveGroupMessage(ANA, "g_x2", "unu", "rid", undefined, "Ana", "G"); // resend
    st().receiveGroupMessage(BOB, "g_x2", "doi", "rid", undefined, "Bob", "G"); // coliziune de id între senderi
    const c = conv("g_x2");
    expect(c.messages.length).toBe(2);
    expect(c.unread).toBe(2);
  });
  it("expeditor blocat → ignorat complet", () => {
    useApp.setState({ blocked: [BOB] });
    st().receiveGroupMessage(BOB, "g_x3", "spam", "r9", undefined, "Bob", "G");
    expect(conv("g_x3")).toBeUndefined();
    useApp.setState({ blocked: [] });
  });
  it("notificarea de grup prefixează numele expeditorului", () => {
    st().receiveGroupMessage(ANA, "g_x4", "hei", "r2", undefined, "Ana", "Gașca");
    expect(notifyMessage).toHaveBeenCalledWith("Gașca", "Ana: hei", "g_x4");
  });
});

describe("applyGroupCtl — membership", () => {
  it("create: setează roster + nume + admin (creatorul intră mereu în roster)", () => {
    st().applyGroupCtl(ANA, { gid: "g_c1", act: "create", members: [ME, BOB], name: "Trupa" });
    const c = conv("g_c1");
    expect(c.admin).toBe(ANA);
    expect(c.members).toEqual([ANA, ME, BOB]);
    expect(c.name).toBe("Trupa");
  });
  it("gt sosit ÎNAINTEA gc:create → create completează conversația auto-creată", () => {
    st().receiveGroupMessage(ANA, "g_c2", "primul", "r1", undefined, "Ana", "Placeholder");
    st().applyGroupCtl(ANA, { gid: "g_c2", act: "create", members: [ME, BOB], name: "Numele real" });
    const c = conv("g_c2");
    expect(c.admin).toBe(ANA);
    expect(c.members).toEqual([ANA, ME, BOB]);
    expect(c.name).toBe("Numele real");
    expect(c.messages.length).toBe(1); // mesajul dinainte rămâne
  });
  it("add/remove de la NE-admin → ignorate; de la admin → aplicate", () => {
    st().applyGroupCtl(ANA, { gid: "g_c3", act: "create", members: [ME, BOB], name: "G" });
    st().applyGroupCtl(BOB, { gid: "g_c3", act: "add", members: ["did:key:z6MkEve"] });
    expect(conv("g_c3").members).toEqual([ANA, ME, BOB]); // ne-adminul nu adaugă
    st().applyGroupCtl(ANA, { gid: "g_c3", act: "add", members: ["did:key:z6MkEve"] });
    expect(conv("g_c3").members).toContain("did:key:z6MkEve");
    st().applyGroupCtl(BOB, { gid: "g_c3", act: "remove", members: [ME] });
    expect(conv("g_c3").members).toContain(ME); // ne-adminul nu scoate
    st().applyGroupCtl(ANA, { gid: "g_c3", act: "remove", members: ["did:key:z6MkEve"] });
    expect(conv("g_c3").members).not.toContain("did:key:z6MkEve");
  });
  it("leave: oricine se scoate DOAR pe sine", () => {
    st().applyGroupCtl(ANA, { gid: "g_c4", act: "create", members: [ME, BOB], name: "G" });
    st().applyGroupCtl(BOB, { gid: "g_c4", act: "leave" });
    expect(conv("g_c4").members).toEqual([ANA, ME]);
  });
  it("gc pt grup necunoscut (non-create) → ignorat, nu crapă", () => {
    st().applyGroupCtl(ANA, { gid: "g_nope", act: "add", members: [BOB] });
    expect(conv("g_nope")).toBeUndefined();
  });
});

describe("markGroupMsgStatus — bife de grup", () => {
  it("urcă statusul mesajului MEU + persistă O(1); nu coboară niciodată", async () => {
    const gid = st().createGroup("Bife", [ANA]);
    const id = st().appendMessage(gid, "al meu", true);
    st().markGroupMsgStatus(gid, id, "delivered");
    expect(conv(gid).messages.find((m: any) => m.id === id).status).toBe("delivered");
    st().markGroupMsgStatus(gid, id, "sent"); // rang mai mic → nu coboară
    expect(conv(gid).messages.find((m: any) => m.id === id).status).toBe("delivered");
    await Promise.resolve();
    expect(mockRepo.setMessageStatus).toHaveBeenCalledWith(gid, id, "delivered");
  });
});
