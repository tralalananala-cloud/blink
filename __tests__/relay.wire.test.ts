/**
 * Faza 1.2 — plasa de siguranță pe PROTOCOLUL DE FIR (messaging/relay.ts).
 *
 * Releul nu vede decât plicuri E2E; toată logica de control trăiește în JSON-ul interior
 *   { k: "t" | "a" | "mh" | "mc" | "e" | "d" | "dc" | "call" }
 * codat la trimitere (send*) și decodat/dispecerizat la primire (handle).
 *
 * Testăm COMPORTAMENTUL real al clasei Relay (nu extragem codec acum — refactorul vine în Faza 3.2,
 * în spatele acestei plase), cu motorul cripto + store-ul + WebSocket + media MOCK-uite. Motorul
 * mock face encrypt/decrypt = identitate (ciphertext == plaintext) → putem face round-trip autentic:
 * capturăm ce pleacă pe WS și reinjectăm plicul în handle().
 */

// expo-crypto: în node folosim webcrypto pt getRandomValues (ca celelalte suite).
jest.mock("expo-crypto", () => ({
  getRandomValues: (arr: any) => require("crypto").webcrypto.getRandomValues(arr),
}));

const MY_DID = "did:key:zMyselfAAAAAAAAAA";
const PEER = "did:key:zPeerBBBBBBBBBBBB";

// --- Motor cripto mock: encrypt/decrypt = identitate, sesiune mereu pregătită ---
const mockEngine: any = {
  hasSession: jest.fn(() => true),
  startOutbound: jest.fn(async () => {}),
  getBundle: jest.fn(() => ({ idKey: "ik", spk: "spk", sig: "sig" })),
  signChallenge: jest.fn((n: string) => "sig:" + n),
  getOpkBatch: jest.fn(() => []),
  encrypt: jest.fn(async (to: string, payload: string) => ({
    fromDid: MY_DID, toDid: to, ciphertext: payload, ts: 1,
  })),
  decrypt: jest.fn(async (env: any) => ({ plaintext: env.ciphertext, fromDid: env.fromDid })),
  // fără encryptSealed/decryptSealed → sealedOn() == false (totul pe calea WS, ușor de capturat)
};
jest.mock("../src/crypto", () => ({ engine: mockEngine }));

// --- Store mock: același obiect întors de getState() ca spionii să fie inspectabili ---
const mockState: any = {
  identity: { did: MY_DID },
  settings: { sealedSender: false, profileName: "Alice" },
  markMsgStatus: jest.fn(),
  receiveMessage: jest.fn(),
  clearNeedsRepair: jest.fn(),
  flagNeedsRepair: jest.fn(),
  applyRemoteEdit: jest.fn(),
  applyRemoteDelete: jest.fn(),
  applyRemoteDeleteConv: jest.fn(),
  takeReadReceipts: jest.fn(() => []),
};
jest.mock("../src/state/store", () => ({ useApp: { getState: () => mockState } }));

// --- Media mock: createMediaSink=null → calea „parts" (RAM), writeMedia → uri fals ---
const mockMedia: any = {
  createMediaSink: jest.fn(() => null),
  writeMedia: jest.fn(async () => "file://reassembled"),
  streamFileChunks: jest.fn(),
  splitChunks: jest.fn(() => []),
  readBase64: jest.fn(),
  MAX_MEDIA_BYTES: 8 * 1024 * 1024,
};
jest.mock("../src/media/wire", () => mockMedia);

// --- WebRTC + Reticulum: stub-uri inofensive ---
const mockCall: any = { setSignalSender: jest.fn(), handleSignal: jest.fn() };
jest.mock("../src/calls/webrtc", () => ({ callManager: mockCall }));
const mockReticulum: any = {
  myAddr: null, register: jest.fn(async () => null), startPolling: jest.fn(), stopPolling: jest.fn(),
  send: jest.fn(async () => false), on: jest.fn(() => false), reset: jest.fn(),
};
jest.mock("../src/messaging/reticulum", () => ({ reticulum: mockReticulum }));

// --- WebSocket fals: captează ce trimite app-ul ---
class MockWS {
  static instances: MockWS[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  constructor(public url: string) { MockWS.instances.push(this); }
  send(d: string) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
}
(global as any).WebSocket = MockWS as any;

// require (NU import) — import-ul ar fi hoist-uit de babel deasupra mock-urilor `const mock*`,
// încărcând relay.ts înainte ca stub-urile să existe (callManager.setSignalSender la load).
const { relay } = require("../src/messaging/relay");

const lastWS = () => MockWS.instances[MockWS.instances.length - 1];
/** Deschide o conexiune „vie" (connected=true) fără a parcurge tot handshake-ul de auth. */
function open(): MockWS {
  relay.connect();
  const ws = lastWS();
  ws.readyState = 1;
  ws.onopen?.();
  ws.sent.length = 0; // aruncă {t:"hello"} ca să rămână doar trimiterile testului
  return ws;
}
/** Ultimul cadru `{t:"send"}` trimis pe WS, cu plicul (env) decodat. */
function lastSend(ws: MockWS): any {
  const sends = ws.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "send");
  return sends[sends.length - 1];
}
/** Toate cadrele `{t:"send"}` trimise. */
function allSends(ws: MockWS): any[] {
  return ws.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "send");
}
/** Simulează primirea unui plic de la PEER (env decodabil de mock-ul de decriptare). */
async function deliver(payloadObj: any, from = PEER): Promise<void> {
  const env = { fromDid: from, toDid: MY_DID, ciphertext: JSON.stringify(payloadObj), ts: 1 };
  await (relay as any).handle(JSON.stringify({ t: "msg", env }));
}
/** Deschide + confirmă reg-ul (`ready`) → pornește ackSweep-ul și golește outbox-ul. */
async function openRegistered(): Promise<MockWS> {
  const ws = open();
  await (relay as any).handle(JSON.stringify({ t: "ready" }));
  return ws;
}
/** Avansează timerele fake apoi lasă microtask-urile (ensureSession/encrypt/transmit) să se rezolve. */
async function tick(ms: number): Promise<void> {
  jest.advanceTimersByTime(ms);
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
/** Toate cadrele `{t:"qack"}` trimise pe WS, cu id-urile aplatizate. */
function qackedIds(ws: MockWS): string[] {
  return ws.sent.map((s) => JSON.parse(s)).filter((m) => m.t === "qack").flatMap((m: any) => m.ids);
}
/** Câte cadre `{t:"send"}` poartă un anume id de mesaj în plic. */
function sendCountFor(ws: MockWS, id: string): number {
  return allSends(ws).filter((f) => JSON.parse(f.env.ciphertext).id === id).length;
}

beforeEach(() => {
  // timere fake: watchdog-ul de reg (5s) + ping/ackSweep nu țin procesul viu și nu se declanșează
  // necontrolat în teste (toate await-urile sunt pe microtask-uri, neafectate de fake timers).
  jest.useFakeTimers();
  jest.clearAllMocks();
  // reaplică implementările pe care clearAllMocks le-a resetat
  mockEngine.hasSession.mockReturnValue(true);
  mockEngine.encrypt.mockImplementation(async (to: string, payload: string) => ({ fromDid: MY_DID, toDid: to, ciphertext: payload, ts: 1 }));
  mockEngine.decrypt.mockImplementation(async (env: any) => ({ plaintext: env.ciphertext, fromDid: env.fromDid }));
  mockMedia.createMediaSink.mockReturnValue(null);
  mockMedia.writeMedia.mockResolvedValue("file://reassembled");
  mockState.takeReadReceipts.mockReturnValue([]);
  MockWS.instances = [];
});

afterEach(() => {
  relay.deregister();      // curăță ping/ackSweep/qack + rupe conexiunea
  jest.clearAllTimers();   // mătură watchdog-ul de reg (deregister nu-l atinge)
  jest.useRealTimers();
});

// ────────────────────────────────────────────────────────────────────────────
describe("encode — fiecare {k} produce cadrul corect pe sârmă", () => {
  it("text {k:'t'} include id, body, nume profil", async () => {
    const ws = open();
    const r = await relay.sendText(PEER, "salut 🔐 ăîâ", "m1");
    expect(r.ok).toBe(true);
    const frame = lastSend(ws);
    expect(frame.to).toBe(PEER);
    const inner = JSON.parse(frame.env.ciphertext);
    expect(inner).toMatchObject({ k: "t", id: "m1", b: "salut 🔐 ăîâ", n: "Alice" });
    expect(mockState.markMsgStatus).toHaveBeenCalledWith(PEER, "m1", "sent");
  });

  it("ack {k:'a'} livrat/citit", async () => {
    const ws = open();
    await relay.sendAck(PEER, "m1", "read");
    const inner = JSON.parse(lastSend(ws).env.ciphertext);
    expect(inner).toMatchObject({ k: "a", id: "m1", s: "read" });
  });

  it("edit {k:'e'} / del-msg {k:'d'} / del-conv {k:'dc'}", async () => {
    const ws = open();
    await relay.sendEdit(PEER, "m1", "corectat");
    await relay.sendDeleteMsg(PEER, "m1");
    await relay.sendDeleteConv(PEER);
    const inners = allSends(ws).map((f) => JSON.parse(f.env.ciphertext));
    expect(inners[0]).toMatchObject({ k: "e", id: "m1", b: "corectat" });
    expect(inners[1]).toMatchObject({ k: "d", id: "m1" });
    expect(inners[2]).toMatchObject({ k: "dc" });
  });

  it("call {k:'call'} duce semnalul WebRTC", async () => {
    const ws = open();
    await relay.sendCallSignal(PEER, { type: "offer", sdp: "x" });
    const inner = JSON.parse(lastSend(ws).env.ciphertext);
    expect(inner).toMatchObject({ k: "call", sig: { type: "offer", sdp: "x" } });
  });

  it("media: antet {k:'mh'} apoi bucată {k:'mc'}", async () => {
    const ws = open();
    mockMedia.streamFileChunks.mockImplementation(async (_uri: string, cb: any) => {
      await cb("CHUNK0", 0, 1);
      return true;
    });
    const r = await relay.sendMedia(PEER, { kind: "image", uri: "file://p.jpg", name: "p.jpg", size: 10 } as any, "med1");
    expect(r.ok).toBe(true);
    const inners = allSends(ws).map((f) => JSON.parse(f.env.ciphertext));
    expect(inners[0]).toMatchObject({ k: "mh", id: "med1", n: 1 });
    expect(inners[0].meta).toMatchObject({ kind: "image", name: "p.jpg" });
    expect(inners[1]).toMatchObject({ k: "mc", id: "med1", i: 0, d: "CHUNK0" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("decode — handle() dispecerizează fiecare {k}", () => {
  it("text {k:'t'} → callback incoming + ack 'delivered' automat", async () => {
    open();
    const got: any[] = [];
    relay.onMessage((from: string, body: string, remoteId?: string, name?: string) => got.push({ from, body, remoteId, name }));
    await deliver({ k: "t", id: "rm1", b: "buna", n: "Bob" });
    expect(got).toEqual([{ from: PEER, body: "buna", remoteId: "rm1", name: "Bob" }]);
    expect(mockState.clearNeedsRepair).toHaveBeenCalledWith(PEER);
  });

  it("ack {k:'a'} → urcă starea mesajului propriu (bife)", async () => {
    open();
    await deliver({ k: "a", id: "m1", s: "read" });
    expect(mockState.markMsgStatus).toHaveBeenCalledWith(PEER, "m1", "read");
  });

  it("ack fără 's' → tratat ca 'delivered'", async () => {
    open();
    await deliver({ k: "a", id: "m2" });
    expect(mockState.markMsgStatus).toHaveBeenCalledWith(PEER, "m2", "delivered");
  });

  it("edit {k:'e'} → applyRemoteEdit", async () => {
    open();
    await deliver({ k: "e", id: "m1", b: "nou" });
    expect(mockState.applyRemoteEdit).toHaveBeenCalledWith(PEER, "m1", "nou");
  });

  it("del-msg {k:'d'} → applyRemoteDelete", async () => {
    open();
    await deliver({ k: "d", id: "m1" });
    expect(mockState.applyRemoteDelete).toHaveBeenCalledWith(PEER, "m1");
  });

  it("del-conv {k:'dc'} → applyRemoteDeleteConv", async () => {
    open();
    await deliver({ k: "dc" });
    expect(mockState.applyRemoteDeleteConv).toHaveBeenCalledWith(PEER);
  });

  it("call {k:'call'} → callManager.handleSignal", async () => {
    open();
    await deliver({ k: "call", sig: { type: "answer" } });
    expect(mockCall.handleSignal).toHaveBeenCalledWith(PEER, { type: "answer" });
  });

  it("media mh+mc (un singur chunk) → receiveMessage cu atașament reasamblat", async () => {
    open();
    await deliver({ k: "mh", id: "x1", n: 1, meta: { kind: "image", name: "p.jpg", size: 10 } });
    await deliver({ k: "mc", id: "x1", i: 0, d: "DATA" });
    expect(mockMedia.writeMedia).toHaveBeenCalled();
    expect(mockState.receiveMessage).toHaveBeenCalledWith(
      PEER, "", "x1", expect.objectContaining({ kind: "image", uri: "file://reassembled" }), undefined,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
describe("round-trip — ce trimite A ajunge corect la B", () => {
  it("textul codat de sendText e decodat de handle la receptor", async () => {
    const ws = open();
    const got: any[] = [];
    relay.onMessage((from: string, body: string, remoteId?: string, name?: string) => got.push({ from, body, remoteId, name }));
    await relay.sendText(PEER, "round 🔁 trip", "rt1");
    const outEnv = lastSend(ws).env;            // plicul exact pus pe sârmă
    outEnv.fromDid = PEER;                        // din perspectiva receptorului, expeditorul e PEER
    await (relay as any).handle(JSON.stringify({ t: "msg", env: outEnv }));
    expect(got).toEqual([{ from: PEER, body: "round 🔁 trip", remoteId: "rt1", name: "Alice" }]);
  });
  // Nota T3: firul `dc` e acoperit de perechea encode (sendDeleteConv → {k:"dc"}) +
  // decode (handle {k:"dc"} → applyRemoteDeleteConv). Un round-trip aparte n-are sens: `dc`
  // e payload fix, fără id, iar amprenta anti-replay (hash pe ciphertext) l-ar dedupe.
});

// ────────────────────────────────────────────────────────────────────────────
describe("robustețe — input malformat NU crapă handle()", () => {
  it("non-JSON brut → ignorat în tăcere", async () => {
    open();
    await expect((relay as any).handle("}{ nu e json")).resolves.toBeUndefined();
  });

  it("cadru fără t/env → ignorat", async () => {
    open();
    await expect((relay as any).handle(JSON.stringify({ foo: 1 }))).resolves.toBeUndefined();
    expect(mockState.receiveMessage).not.toHaveBeenCalled();
  });

  it("plaintext care nu e JSON → tratat ca text simplu (fallback peer vechi)", async () => {
    open();
    const got: any[] = [];
    relay.onMessage((from: string, body: string, remoteId?: string) => got.push({ from, body, remoteId }));
    const env = { fromDid: PEER, toDid: MY_DID, ciphertext: "doar niște text", ts: 1 };
    await (relay as any).handle(JSON.stringify({ t: "msg", env }));
    expect(got).toEqual([{ from: PEER, body: "doar niște text", remoteId: undefined }]);
  });

  it("control {k} cu câmpuri lipsă → nu aruncă, nu dispecerizează greșit", async () => {
    open();
    await expect(deliver({ k: "e" })).resolves.toBeUndefined();           // edit fără id
    await expect(deliver({ k: "d" })).resolves.toBeUndefined();           // del fără id
    await expect(deliver({ k: "mc", id: "z", i: 0, d: "x" })).resolves.toBeUndefined(); // chunk fără antet
    expect(mockState.applyRemoteEdit).not.toHaveBeenCalled();
    expect(mockState.applyRemoteDelete).not.toHaveBeenCalled();
  });

  it("decriptare eșuată pe contact cu sesiune → flag re-pair, fără crash", async () => {
    open();
    mockEngine.decrypt.mockRejectedValueOnce(new Error("ratchet desync"));
    const env = { fromDid: PEER, toDid: MY_DID, ciphertext: "gunoi", ts: 1 };
    await expect((relay as any).handle(JSON.stringify({ t: "msg", env }))).resolves.toBeUndefined();
    expect(mockState.flagNeedsRepair).toHaveBeenCalledWith(PEER);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Faza 1.3 — outbox / livrare / dedupe
// ────────────────────────────────────────────────────────────────────────────
describe("outbox — mesajele supraviețuiesc deconectării", () => {
  it("trimis offline → pus în coadă, apoi golit la (re)conectare", async () => {
    // fără conexiune (afterEach a făcut deregister) → sendText pune în outbox, nu trimite
    const r = await relay.sendText(PEER, "cât eram offline", "ob1");
    expect(r).toMatchObject({ ok: true, reason: "queued" });
    // reconectare + reg confirmat → flushOutbox livrează
    const ws = await openRegistered();
    await tick(0);
    const inners = allSends(ws).map((f) => JSON.parse(f.env.ciphertext));
    expect(inners.some((i) => i.id === "ob1" && i.b === "cât eram offline")).toBe(true);
  });

  it("dedupe outbox după id (același mesaj cozit de două ori → un singur flush)", async () => {
    await relay.sendText(PEER, "x", "dup1");
    await relay.sendText(PEER, "x", "dup1"); // același id
    const ws = await openRegistered();
    await tick(0);
    expect(sendCountFor(ws, "dup1")).toBe(1);
  });
});

describe("livrare — resend pe ack-timeout (socket-zombi)", () => {
  it("fără 'delivered' în ACK_TIMEOUT → mesajul se retrimite (același id)", async () => {
    const ws = await openRegistered();
    await relay.sendText(PEER, "are nevoie de ack", "rs1");
    expect(sendCountFor(ws, "rs1")).toBe(1);
    await tick(6000); // ACK_TIMEOUT — sweep-ul (3s) ajunge la scadență și retrimite
    expect(sendCountFor(ws, "rs1")).toBeGreaterThan(1);
  });

  it("ack-ul 'delivered' oprește resend-urile", async () => {
    const ws = await openRegistered();
    await relay.sendText(PEER, "confirmat repede", "rs2");
    await deliver({ k: "a", id: "rs2", s: "delivered" }); // peer-ul confirmă
    const n = sendCountFor(ws, "rs2");
    await tick(30000); // mult peste timeout
    expect(sendCountFor(ws, "rs2")).toBe(n); // niciun resend după confirmare
    expect((relay as any).pendingAck.has("rs2")).toBe(false);
  });

  it("renunță după ACK_MAX_ATTEMPTS (rămâne la ✓, nu retrimite la infinit)", async () => {
    const ws = await openRegistered();
    await relay.sendText(PEER, "peer mort", "rs3");
    // avansează un sweep (3s) odată, ca tail-ul async al fiecărui resend să se așeze între
    // ticks (ca în realitate) — altfel un singur salt mare ar re-insera intrarea abia ștearsă.
    for (let i = 0; i < 250 && (relay as any).pendingAck.has("rs3"); i++) await tick(3000);
    expect((relay as any).pendingAck.has("rs3")).toBe(false); // abandonat după max încercări
    expect(sendCountFor(ws, "rs3")).toBeLessThanOrEqual(1 + 8); // trimitere inițială + ≤ ACK_MAX_ATTEMPTS
  });
});

describe("dedupe la receptor + qack (livrare at-least-once)", () => {
  it("același plic livrat de două ori → procesat o singură dată", async () => {
    await openRegistered();
    const got: string[] = [];
    relay.onMessage((_f: string, _b: string, remoteId?: string) => { if (remoteId) got.push(remoteId); });
    const env = { fromDid: PEER, toDid: MY_DID, ciphertext: JSON.stringify({ k: "t", id: "dd1", b: "buna", n: "B" }), ts: 1 };
    await (relay as any).handle(JSON.stringify({ t: "msg", env, qid: "qa" }));
    await (relay as any).handle(JSON.stringify({ t: "msg", env, qid: "qb" })); // replay / re-livrare
    expect(got).toEqual(["dd1"]); // un singur callback, fără reprocesare
  });

  it("ambele livrări (originală + duplicat) sunt confirmate releului prin qack", async () => {
    const ws = await openRegistered();
    relay.onMessage(() => {});
    const env = { fromDid: PEER, toDid: MY_DID, ciphertext: JSON.stringify({ k: "t", id: "dd2", b: "y", n: "B" }), ts: 1 };
    await (relay as any).handle(JSON.stringify({ t: "msg", env, qid: "q1" }));
    await (relay as any).handle(JSON.stringify({ t: "msg", env, qid: "q2" }));
    await tick(200); // debounce qack 150ms
    const ids = qackedIds(ws);
    expect(ids).toContain("q1");
    expect(ids).toContain("q2"); // duplicatul tot e scos din coada releului (nu se re-livrează la infinit)
  });

  it("decriptare eșuată → NU se confirmă qack (mesajul rămâne în coadă)", async () => {
    const ws = await openRegistered();
    mockEngine.decrypt.mockRejectedValueOnce(new Error("nedecriptabil"));
    const env = { fromDid: PEER, toDid: MY_DID, ciphertext: "gunoi", ts: 1 };
    await (relay as any).handle(JSON.stringify({ t: "msg", env, qid: "qf" }));
    await tick(200);
    expect(qackedIds(ws)).not.toContain("qf"); // commit doar după decriptare reușită
  });

  it("mesaj decriptat din coadă → se confirmă qack-ul lui", async () => {
    const ws = await openRegistered();
    relay.onMessage(() => {});
    const env = { fromDid: PEER, toDid: MY_DID, ciphertext: JSON.stringify({ k: "t", id: "ok1", b: "z", n: "B" }), ts: 1 };
    await (relay as any).handle(JSON.stringify({ t: "msg", env, qid: "qok" }));
    await tick(200);
    expect(qackedIds(ws)).toContain("qok");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// T2 — media: anti-blocaj (head-of-line) + abandon curat al transferului mort
// ────────────────────────────────────────────────────────────────────────────
describe("T2 — media incompletă nu blochează textul; transferul mort e abandonat", () => {
  it("media întreruptă → un text ulterior ajunge oricum; intrarea moartă e măturată după TTL", async () => {
    open();
    const got: any[] = [];
    relay.onMessage((from: string, body: string, remoteId?: string) => got.push({ from, body, remoteId }));
    // media de 3 bucăți, dar vine doar antetul + o bucată → transfer incomplet (întrerupt)
    await deliver({ k: "mh", id: "big1", n: 3, meta: { kind: "image", name: "big.jpg", size: 999 } });
    await deliver({ k: "mc", id: "big1", i: 0, d: "PART0" });
    expect((relay as any).mediaAsm.size).toBe(1); // reasamblare în curs
    // text trimis IMEDIAT după poză → ajunge fără să aștepte media (fără head-of-line)
    await deliver({ k: "t", id: "afterbig", b: "text dupa poza", n: "B" });
    expect(got).toEqual([{ from: PEER, body: "text dupa poza", remoteId: "afterbig" }]);
    expect(mockState.receiveMessage).not.toHaveBeenCalled(); // media incompletă → niciun mesaj media
    // ceasul de abandon: după MEDIA_ASM_TTL_MS fără bucăți noi, sweep-ul curăță intrarea moartă
    (relay as any).sweepStaleMedia(Date.now() + 46000);
    expect((relay as any).mediaAsm.size).toBe(0);
  });

  it("un transfer media recent NU e abandonat de sweep (sub TTL)", async () => {
    open();
    await deliver({ k: "mh", id: "fresh1", n: 2, meta: { kind: "image", name: "f.jpg" } });
    await deliver({ k: "mc", id: "fresh1", i: 0, d: "A" });
    (relay as any).sweepStaleMedia(Date.now() + 1000); // cu mult sub TTL
    expect((relay as any).mediaAsm.size).toBe(1); // încă viu
  });

  it("C2.4 — mh nou peste un transfer în curs (resend) abortează sink-ul vechi → fără fișier corupt", async () => {
    open();
    const sinks: any[] = [];
    mockMedia.createMediaSink.mockImplementation(() => {
      const s = { writeChunk: jest.fn(), finish: jest.fn(() => "file://x"), abort: jest.fn() };
      sinks.push(s);
      return s;
    });
    // transfer în curs: antet + o bucată scrisă în sink-ul #0
    await deliver({ k: "mh", id: "dup1", n: 3, meta: { kind: "image", name: "p.jpg" }, _v: 1 });
    await deliver({ k: "mc", id: "dup1", i: 0, d: "A" });
    expect(sinks.length).toBe(1);
    // resend al expeditorului (re-criptat → ciphertext diferit, NU dedupat): al doilea mh pt ACELAȘI id
    await deliver({ k: "mh", id: "dup1", n: 3, meta: { kind: "image", name: "p.jpg" }, _v: 2 });
    expect(sinks[0].abort).toHaveBeenCalledTimes(1); // sink-ul vechi ÎNCHIS/ȘTERS înainte de-al doilea
    expect(sinks.length).toBe(2);                     // sink nou pt transferul reluat
  });
});
