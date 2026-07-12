/**
 * BLE-1 — stratul TS al transportului BLE mesh (messaging/ble.ts).
 * Modulul nativ BlinkBle e MOCK (Kotlin-ul vine în lotul BLE-2, ca expo-sqlite/libsignal —
 * nativele nu rulează în jest). Acoperă: did8, gating on(), descoperire peers (seen/lost),
 * recepție blob → callback, send prin nativ + eșec curat, reset.
 */

// Setările sunt citite din store — mock stateful, comutat per test.
let mockSettings: any = { bleMeshEnabled: true };
jest.mock("../src/state/store", () => ({
  useApp: { getState: () => ({ settings: mockSettings }) },
}));

// Nativul fake: captează listenerii ca să putem emite evenimente în teste.
type Cb = (e: any) => void;
const mockListeners: Record<string, Cb[]> = {};
const mockNative = {
  start: jest.fn(async () => {}),
  stop: jest.fn(async () => {}),
  send: jest.fn(async () => true),
  addListener: jest.fn((ev: string, cb: Cb) => {
    (mockListeners[ev] ??= []).push(cb);
    return { remove: () => {} };
  }),
};
let mockAvailable = true;
let mockPerms = true; // permisiunile Bluetooth acordate?
jest.mock("../src/messaging/bleNative", () => ({
  loadBleNative: () => (mockAvailable ? mockNative : null),
  ensureBlePermissions: async () => mockPerms,
}));

const emit = (ev: string, e: any) => { for (const cb of mockListeners[ev] ?? []) cb(e); };

// bleMesh cache-uiește nativul la primul acces → instanță PROASPĂTĂ per test (resetModules),
// altfel un test cu mockAvailable=false ar otrăvi restul. `require`, nu `import` (hoisting).
function fresh() {
  jest.resetModules();
  for (const k of Object.keys(mockListeners)) delete mockListeners[k];
  mockNative.start.mockClear(); mockNative.stop.mockClear(); mockNative.send.mockClear();
  return require("../src/messaging/ble") as typeof import("../src/messaging/ble");
}

describe("did8", () => {
  it("e determinist, 16 hex, diferit pe DID-uri diferite", () => {
    const { did8 } = fresh();
    expect(did8("did:key:alice")).toMatch(/^[0-9a-f]{16}$/);
    expect(did8("did:key:alice")).toBe(did8("did:key:alice"));
    expect(did8("did:key:alice")).not.toBe(did8("did:key:bob"));
  });
});

describe("gating on()", () => {
  it("false cu toggle-ul oprit, chiar dacă nativul există", () => {
    mockAvailable = true; mockSettings = { bleMeshEnabled: false };
    expect(fresh().bleMesh.on()).toBe(false);
  });
  it("false fără modul nativ, chiar cu toggle-ul pornit", () => {
    mockAvailable = false; mockSettings = { bleMeshEnabled: true };
    expect(fresh().bleMesh.on()).toBe(false);
  });
  it("true cu toggle + nativ", () => {
    mockAvailable = true; mockSettings = { bleMeshEnabled: true };
    expect(fresh().bleMesh.on()).toBe(true);
  });
});

describe("descoperire + recepție", () => {
  beforeEach(() => { mockAvailable = true; mockPerms = true; mockSettings = { bleMeshEnabled: true }; });

  it("permisiuni refuzate → start false, nativul NU e pornit", async () => {
    const { bleMesh } = fresh();
    mockPerms = false;
    expect(await bleMesh.start("did:key:me", () => {})).toBe(false);
    expect(mockNative.start).not.toHaveBeenCalled();
    mockPerms = true;
  });

  it("start anunță did8-ul propriu; onPeerSeen/onPeerLost mișcă canReach", async () => {
    const { bleMesh, did8 } = fresh();
    expect(await bleMesh.start("did:key:me", () => {})).toBe(true);
    // BLE-4: start primește și textele notificării serviciului de foreground. Nu fixăm conținutul
    // (vine din i18n), dar NU are voie să fie gol — o notificare fără text = serviciu respins de Android.
    expect(mockNative.start).toHaveBeenCalledWith(
      did8("did:key:me"),
      expect.stringMatching(/\S/),
      expect.stringMatching(/\S/),
    );
    expect(bleMesh.canReach("did:key:peer")).toBe(false);
    emit("onPeerSeen", { did8: did8("did:key:peer") });
    expect(bleMesh.canReach("did:key:peer")).toBe(true);
    emit("onPeerLost", { did8: did8("did:key:peer") });
    expect(bleMesh.canReach("did:key:peer")).toBe(false);
  });

  it("blob-urile primite ajung în callback", async () => {
    const { bleMesh } = fresh();
    const got: string[] = [];
    await bleMesh.start("did:key:me", (b) => got.push(b));
    emit("onBlob", { blobB64: "cGxpYw==" });
    expect(got).toEqual(["cGxpYw=="]);
  });

  it("eșecul lui start (BT oprit/permisiuni) lasă transportul oprit, fără crash", async () => {
    const { bleMesh } = fresh();
    mockNative.start.mockRejectedValueOnce(new Error("bt off"));
    expect(await bleMesh.start("did:key:me", () => {})).toBe(false);
    expect(await bleMesh.send("did:key:peer", "x")).toBe(false); // nestartat → nu încearcă
  });
});

describe("send", () => {
  beforeEach(() => { mockAvailable = true; mockSettings = { bleMeshEnabled: true }; });

  it("trimite prin nativ către did8-ul peer-ului", async () => {
    const { bleMesh, did8 } = fresh();
    await bleMesh.start("did:key:me", () => {});
    expect(await bleMesh.send("did:key:peer", "YmxvYg==")).toBe(true);
    expect(mockNative.send).toHaveBeenCalledWith(did8("did:key:peer"), "YmxvYg==");
  });

  it("excepția nativă devine false (transmit cade pe următorul transport)", async () => {
    const { bleMesh } = fresh();
    await bleMesh.start("did:key:me", () => {});
    mockNative.send.mockRejectedValueOnce(new Error("gatt fail"));
    expect(await bleMesh.send("did:key:peer", "x")).toBe(false);
  });
});

describe("reset", () => {
  it("oprește nativul și uită peer-ii", async () => {
    mockAvailable = true; mockSettings = { bleMeshEnabled: true };
    const { bleMesh, did8 } = fresh();
    await bleMesh.start("did:key:me", () => {});
    emit("onPeerSeen", { did8: did8("did:key:peer") });
    bleMesh.reset();
    expect(mockNative.stop).toHaveBeenCalled();
    expect(bleMesh.canReach("did:key:peer")).toBe(false);
  });
});

export {};
