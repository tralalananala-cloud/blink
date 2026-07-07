/**
 * Lot GRUPURI v1 (G3) — fan-out pairwise (src/messaging/group.ts) cu relay + store MOCK:
 * N plicuri gt cu același msgId, coadă offline per membru (chei compuse msgId|did prin Outbox),
 * bife AGREGATE (✓✓ doar când TOȚI confirmă), resend doar către membrii neconfirmați,
 * membership fan-out (create/add/remove/leave, noii membri primesc roster-ul complet).
 * Pattern 1.3: require (nu import), fake timers, sweep avansat cu UN pas (3s) odată.
 */
export {}; // fișier-modul — izolează scope-ul de celelalte teste

const mockRelay: any = {
  connected: true,
  hooks: null as any,
  isConnected: jest.fn(() => mockRelay.connected),
  sendGroupOne: jest.fn(async () => ({ ok: true })),
  sendMedia: jest.fn(async () => ({ ok: true })),
  sendGroupCtl: jest.fn(async () => {}),
  setGroupHooks: jest.fn((h: any) => { mockRelay.hooks = h; }),
};
jest.mock("../src/messaging/relay", () => ({ relay: mockRelay }));

const ME = "did:key:z6MkMe", ANA = "did:key:z6MkAna", BOB = "did:key:z6MkBob", EVE = "did:key:z6MkEve";
const mockState: any = {
  identity: { did: ME },
  conversations: [] as any[],
  markGroupMsgStatus: jest.fn(),
  // membership minimal (gărzile reale de admin sunt testate în storeGroup.test.ts)
  applyGroupCtl: jest.fn((fromDid: string, gc: any) => {
    const c = mockState.conversations.find((x: any) => x.id === gc.gid);
    if (!c) return;
    if (gc.act === "add" && c.admin === fromDid) c.members = Array.from(new Set([...c.members, ...(gc.members ?? [])]));
    if (gc.act === "remove" && c.admin === fromDid) c.members = c.members.filter((d: string) => !(gc.members ?? []).includes(d));
    if (gc.act === "leave") c.members = c.members.filter((d: string) => d !== fromDid);
  }),
};
jest.mock("../src/state/store", () => ({ useApp: { getState: () => mockState } }));

const grp = require("../src/messaging/group");

const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
// gotcha 1.3: sweep-ul se avansează cu UN pas (3s) odată, altfel cozile async se re-așază greșit
const sweep = async (times = 1) => { for (let i = 0; i < times; i++) { jest.advanceTimersByTime(3000); await flush(); } };
const freshGroup = () => {
  mockState.conversations = [{ id: "g1", group: true, name: "Gașca", did: "g1", admin: ME, members: [ME, ANA, BOB], unread: 0, lastTs: 0, messages: [] }];
};

beforeAll(() => jest.useFakeTimers());
afterAll(() => jest.useRealTimers());
beforeEach(() => {
  jest.clearAllMocks();
  mockRelay.connected = true;
  mockRelay.sendGroupOne.mockResolvedValue({ ok: true });
  freshGroup();
  mockRelay.hooks.onReset(); // golește outbox-ul de grup + progresul între teste
});

describe("sendGroupText — fan-out", () => {
  it("N-1 plicuri gt cu ACELAȘI msgId (nu și către mine) + ✓ sent", async () => {
    const r = await grp.sendGroupText("g1", "salut grup", "m1");
    expect(mockRelay.sendGroupOne).toHaveBeenCalledTimes(2);
    expect(mockRelay.sendGroupOne).toHaveBeenCalledWith(ANA, { gid: "g1", gname: "Gașca", text: "salut grup" }, "m1");
    expect(mockRelay.sendGroupOne).toHaveBeenCalledWith(BOB, { gid: "g1", gname: "Gașca", text: "salut grup" }, "m1");
    expect(mockState.markGroupMsgStatus).toHaveBeenCalledWith("g1", "m1", "sent");
    expect(r).toEqual({ ok: true, sentTo: 2, total: 2 });
  });
  it("offline → cozit per membru; la onReady (reconectare) pleacă tot + ✓ sent", async () => {
    mockRelay.connected = false;
    await grp.sendGroupText("g1", "din beznă", "m2");
    expect(mockRelay.sendGroupOne).not.toHaveBeenCalled();
    mockRelay.connected = true;
    mockRelay.hooks.onReady();
    await flush();
    expect(mockRelay.sendGroupOne).toHaveBeenCalledTimes(2);
    expect(mockState.markGroupMsgStatus).toHaveBeenCalledWith("g1", "m2", "sent");
  });
  it("eșec la un membru → cozit doar el; ceilalți pleacă", async () => {
    mockRelay.sendGroupOne.mockImplementation(async (to: string) => ({ ok: to !== BOB }));
    const r = await grp.sendGroupText("g1", "x", "m3");
    expect(r.sentTo).toBe(1);
    mockRelay.sendGroupOne.mockClear();
    mockRelay.sendGroupOne.mockResolvedValue({ ok: true });
    mockRelay.hooks.onReady(); // flush re-încearcă DOAR ce-i în coadă
    await flush();
    expect(mockRelay.sendGroupOne).toHaveBeenCalledTimes(1);
    expect(mockRelay.sendGroupOne).toHaveBeenCalledWith(BOB, expect.anything(), "m3");
  });
});

describe("bife agregate — onAck", () => {
  it("✓✓ delivered abia când TOȚI membrii au confirmat; read la fel", async () => {
    await grp.sendGroupText("g1", "x", "m4");
    mockState.markGroupMsgStatus.mockClear();
    mockRelay.hooks.onAck(ANA, "m4", "delivered");
    expect(mockState.markGroupMsgStatus).not.toHaveBeenCalled(); // 1 din 2 → rămâne ✓
    mockRelay.hooks.onAck(BOB, "m4", "delivered");
    expect(mockState.markGroupMsgStatus).toHaveBeenCalledWith("g1", "m4", "delivered");
    mockRelay.hooks.onAck(ANA, "m4", "read");
    mockRelay.hooks.onAck(BOB, "m4", "read");
    expect(mockState.markGroupMsgStatus).toHaveBeenCalledWith("g1", "m4", "read");
  });
  it("ack de la un NE-membru sau pt mesaj necunoscut → ignorat", async () => {
    await grp.sendGroupText("g1", "x", "m5");
    mockState.markGroupMsgStatus.mockClear();
    mockRelay.hooks.onAck(EVE, "m5", "delivered");
    mockRelay.hooks.onAck(ANA, "necunoscut", "delivered");
    expect(mockState.markGroupMsgStatus).not.toHaveBeenCalled();
  });
});

describe("resend pe ack-timeout — per membru", () => {
  it("membrul care a confirmat NU mai primește resend; celălalt da", async () => {
    mockRelay.hooks.onReady(); // pornește sweep-ul
    await grp.sendGroupText("g1", "x", "m6");
    mockRelay.hooks.onAck(ANA, "m6", "delivered"); // Ana confirmă
    mockRelay.sendGroupOne.mockClear();
    await sweep(3); // 9s > ACK_TIMEOUT 6s → resend
    const targets = mockRelay.sendGroupOne.mock.calls.map((c: any[]) => c[0]);
    expect(targets).toContain(BOB);
    expect(targets).not.toContain(ANA);
  });
});

describe("membership fan-out", () => {
  it("announceGroup: gc:create cu roster complet + nume, către toți ceilalți", () => {
    grp.announceGroup("g1");
    expect(mockRelay.sendGroupCtl).toHaveBeenCalledTimes(2);
    expect(mockRelay.sendGroupCtl).toHaveBeenCalledWith(ANA, expect.objectContaining({ k: "gc", act: "create", gid: "g1", members: [ME, ANA, BOB], name: "Gașca" }));
  });
  it("addMembers: noul membru primește create (roster complet), vechii primesc add", () => {
    grp.addMembers("g1", [EVE]);
    const calls = mockRelay.sendGroupCtl.mock.calls;
    const toEve = calls.find((c: any[]) => c[0] === EVE)?.[1];
    const toAna = calls.find((c: any[]) => c[0] === ANA)?.[1];
    expect(toEve).toMatchObject({ act: "create", members: [ME, ANA, BOB, EVE], name: "Gașca" });
    expect(toAna).toMatchObject({ act: "add", members: [EVE] });
  });
  it("removeMembers: și membrul SCOS e anunțat (roster-ul vechi)", () => {
    grp.removeMembers("g1", [BOB]);
    const targets = mockRelay.sendGroupCtl.mock.calls.map((c: any[]) => c[0]);
    expect(targets).toContain(BOB); // cel scos află că a fost scos
    expect(targets).toContain(ANA);
    expect(mockState.conversations[0].members).toEqual([ME, ANA]);
  });
  it("leaveGroup: anunță ceilalți + mă scot local din roster", () => {
    grp.leaveGroup("g1");
    const targets = mockRelay.sendGroupCtl.mock.calls.map((c: any[]) => c[0]);
    expect(targets).toEqual(expect.arrayContaining([ANA, BOB]));
    expect(mockState.conversations[0].members).toEqual([ANA, BOB]);
  });
});

describe("sendGroupMedia", () => {
  it("N trimiteri cu gid pe antet; offline → refuz onest (nu se cozește)", async () => {
    const att = { kind: "image", uri: "file:///x.jpg" };
    const r = await grp.sendGroupMedia("g1", att, "m7");
    expect(mockRelay.sendMedia).toHaveBeenCalledTimes(2);
    expect(mockRelay.sendMedia).toHaveBeenCalledWith(ANA, att, "m7", "g1");
    expect(r.ok).toBe(true);
    mockRelay.connected = false;
    const r2 = await grp.sendGroupMedia("g1", att, "m8");
    expect(r2.ok).toBe(false);
  });
});
