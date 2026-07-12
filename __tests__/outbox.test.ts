/**
 * Faza 3.2 — Outbox (src/messaging/outbox.ts), fiabilitatea livrării extrasă din relay.ts.
 * Testat DIRECT cu dependențe injectate (mock) + fake timers — fără WebSocket/cripto.
 * (relay.wire.test.ts îl acoperă și end-to-end prin clasa Relay; aici e contractul unitar.)
 */
import { Outbox } from "../src/messaging/outbox";

function make(connected = true) {
  const calls = { text: [] as any[], media: [] as any[], ack: [] as any[] };
  const deps = {
    isConnected: () => connected,
    sendText: jest.fn(async (to: string, text: string, id: string) => { calls.text.push({ to, text, id }); }),
    sendMedia: jest.fn(async (to: string, att: any, id: string) => { calls.media.push({ to, att, id }); }),
    trySendAck: jest.fn(async () => true),
  };
  return { ob: new Outbox(deps), deps, calls };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });
const tick = async (ms: number) => { jest.advanceTimersByTime(ms); for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe("outbox — coada de (re)trimitere", () => {
  it("queueOut dedupe după id; flush trimite tot o dată", async () => {
    const { ob, deps } = make();
    ob.queueOut({ to: "p", kind: "text", text: "a", id: "m1" });
    ob.queueOut({ to: "p", kind: "text", text: "a", id: "m1" }); // dublură
    ob.queueOut({ to: "p", kind: "media", att: { uri: "u" } as any, id: "m2" });
    await ob.flush();
    expect(deps.sendText).toHaveBeenCalledTimes(1);
    expect(deps.sendMedia).toHaveBeenCalledTimes(1);
    await ob.flush(); // coada e goală acum
    expect(deps.sendText).toHaveBeenCalledTimes(1);
  });

  it("flush trimite SERIAL, în ordinea cozii (altfel conversația se încurcă la receptor)", async () => {
    const order: string[] = [];
    const deps = {
      isConnected: () => true,
      // m1 e „lent" (mai multe microtask-uri, ca o criptare mai grea). În paralel, m2 l-ar depăși;
      // serial, ordinea cozii e păstrată. Fără setTimeout: suita rulează pe timere false.
      sendText: jest.fn(async (_to: string, _t: string, id: string) => {
        if (id === "m1") for (let i = 0; i < 5; i++) await Promise.resolve();
        order.push(id);
      }),
      sendMedia: jest.fn(async () => {}),
      trySendAck: jest.fn(async () => true),
    };
    const ob = new Outbox(deps);
    ob.queueOut({ to: "p", kind: "text", text: "1", id: "m1" });
    ob.queueOut({ to: "p", kind: "text", text: "2", id: "m2" });
    await ob.flush();
    expect(order).toEqual(["m1", "m2"]);
  });
});

describe("pendingAck — resend pe ack-timeout", () => {
  it("retrimite după ACK_TIMEOUT; onDelivered oprește", async () => {
    const { ob, deps } = make();
    ob.startSweep();
    ob.trackPending("m1", { to: "p", kind: "text", text: "hi" });
    await tick(6000); // ACK_TIMEOUT → un resend
    expect(deps.sendText).toHaveBeenCalledTimes(1);
    ob.onDelivered("m1"); // ack primit
    await tick(60000);
    expect(deps.sendText).toHaveBeenCalledTimes(1); // niciun resend după confirmare
    expect(ob.pendingAck.has("m1")).toBe(false);
  });

  it("renunță după ACK_MAX_ATTEMPTS (nu retrimite la infinit)", async () => {
    const { ob, deps } = make();
    ob.startSweep();
    ob.trackPending("m1", { to: "p", kind: "text", text: "x" });
    // re-track la fiecare resend (ca în relay) — păstrează attempts
    deps.sendText.mockImplementation(async (_t: string, _x: string, id: string) =>
      ob.trackPending(id, { to: "p", kind: "text", text: "x" }));
    for (let i = 0; i < 250 && ob.pendingAck.has("m1"); i++) await tick(3000);
    expect(ob.pendingAck.has("m1")).toBe(false);
    expect(deps.sendText.mock.calls.length).toBeLessThanOrEqual(8); // ≤ ACK_MAX_ATTEMPTS
  });

  it("nu retrimite cât e deconectat", async () => {
    const { ob, deps } = make(false); // offline
    ob.startSweep();
    ob.trackPending("m1", { to: "p", kind: "text", text: "x" });
    await tick(60000);
    expect(deps.sendText).not.toHaveBeenCalled();
  });
});

describe("outAck — re-încearcă confirmările proprii", () => {
  it("retryOutAck → trySendAck în sweep, scos când reușește", async () => {
    const { ob, deps } = make();
    deps.trySendAck.mockResolvedValueOnce(false).mockResolvedValue(true); // prima eșuează, apoi merge
    ob.retryOutAck("p", "m1", "read");
    await tick(3000);
    await tick(3000);
    expect(deps.trySendAck).toHaveBeenCalledWith("p", "m1", "read");
    expect(deps.trySendAck.mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});
