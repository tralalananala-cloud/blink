/**
 * Outbox — fiabilitatea livrării (Faza 3.2), extras din relay.ts.
 * Trei cozi + un sweep periodic; transmiterea efectivă e injectată (callback-uri spre relay),
 * deci modulul nu știe nimic de WebSocket/cripto:
 *   • outbox     — mesaje de trimis care așteaptă (re)conectarea (nu se pierd la conexiune capricioasă)
 *   • pendingAck — mesaje predate releului fără „delivered" → RETRIMISE pe timeout cu backoff
 *                  (rezolvă socketul-zombi: releul zice LIVRAT-LIVE pe un socket mort → fără resend
 *                  mesajul ar rămâne la o bifă până la restart manual)
 *   • outAck     — confirmările PROPRII (livrat/citit) care n-au putut pleca → RE-ÎNCERCATE
 * Acoperit de relay.wire.test.ts (1.3): resend pe ack-timeout, stop pe ack, give-up după max, flush.
 */
import { Attachment } from "../data/mockData";
import { AckKind } from "./codec";

const ACK_TIMEOUT = 6000;       // cât așteptăm un „delivered" înainte de a retrimite mesajul
const ACK_MAX_ATTEMPTS = 8;     // resend-uri pt mesaj (acoperă un peer offline câteva minute)
const ACK_BACKOFF_CAP = 60000;  // intervalul dintre resend-uri nu crește peste 60s
const OUTACK_MAX_ATTEMPTS = 15; // re-încercări pt confirmările proprii (sesiune nepregătită)

type OutItem = { to: string; kind: "text" | "media"; text?: string; att?: Attachment; id: string };
type Pending = { to: string; kind: "text" | "media"; text?: string; att?: Attachment; attempts: number; nextAt: number };

/** Transmiterea efectivă, injectată de relay (Outbox nu atinge rețeaua direct). */
export interface OutboxDeps {
  isConnected: () => boolean;
  sendText: (to: string, text: string, id: string) => Promise<unknown>;
  sendMedia: (to: string, att: Attachment, id: string) => Promise<unknown>;
  trySendAck: (to: string, id: string, kind: AckKind) => Promise<boolean>;
}

export class Outbox {
  private outbox: OutItem[] = [];
  // public (readonly la consum) — relay îl expune ca `relay.pendingAck` pt testele 1.3.
  readonly pendingAck = new Map<string, Pending>();
  private outAck = new Map<string, { to: string; id: string; kind: AckKind; attempts: number }>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: OutboxDeps) {}

  /** Pune un mesaj în coada de (re)trimitere; dedupe după id. */
  queueOut(item: OutItem) {
    if (!this.outbox.some((x) => x.id === item.id)) this.outbox.push(item);
  }

  /** Golește coada de așteptare — re-trimite tot (la reconectare/reg confirmat). */
  flush() {
    if (!this.outbox.length) return;
    const items = this.outbox;
    this.outbox = [];
    for (const it of items) {
      if (it.kind === "text") void this.deps.sendText(it.to, it.text!, it.id);
      else if (it.att) void this.deps.sendMedia(it.to, it.att, it.id);
    }
  }

  // Reține un mesaj predat releului până vine „delivered". La resend (intrarea există deja)
  // PĂSTRĂM attempts/nextAt (setate de sweep) — altfel s-ar reseta și ar retrimite la infinit.
  trackPending(id: string, item: { to: string; kind: "text" | "media"; text?: string; att?: Attachment }) {
    const ex = this.pendingAck.get(id);
    if (ex) { ex.to = item.to; ex.kind = item.kind; ex.text = item.text; ex.att = item.att; return; }
    this.pendingAck.set(id, { ...item, attempts: 0, nextAt: Date.now() + ACK_TIMEOUT });
  }

  /** Ack „delivered" primit → nu mai retrimite mesajul. */
  onDelivered(id: string) { this.pendingAck.delete(id); }

  /** O confirmare proprie n-a putut pleca → re-încearc-o în sweep. */
  retryOutAck(to: string, id: string, kind: AckKind) {
    this.outAck.set(`${to}|${id}|${kind}`, { to, id, kind, attempts: 0 });
    this.startSweep();
  }

  startSweep() {
    this.stopSweep();
    this.timer = setInterval(() => this.sweep(), 3000);
  }
  stopSweep() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  // Retrimite mesajele neconfirmate ajunse la timeout (același msgId → receptorul face dedupe)
  // ȘI re-încearcă confirmările proprii care n-au putut pleca (sesiune nepregătită la flush).
  private sweep() {
    if (!this.deps.isConnected()) return;
    const now = Date.now();
    for (const [id, p] of this.pendingAck) {
      if (now < p.nextAt) continue;
      if (p.attempts >= ACK_MAX_ATTEMPTS) { this.pendingAck.delete(id); continue; } // renunță (rămâne ✓)
      p.attempts++;
      p.nextAt = now + Math.min(ACK_TIMEOUT * Math.pow(1.8, p.attempts), ACK_BACKOFF_CAP); // backoff plafonat
      if (p.kind === "text") void this.deps.sendText(p.to, p.text!, id);
      else if (p.att) void this.deps.sendMedia(p.to, p.att, id);
    }
    // re-trimite confirmările de livrare/citire blocate (sesiunea spre expeditor s-a încălzit între timp)
    for (const [key, a] of this.outAck) {
      a.attempts++;
      if (a.attempts > OUTACK_MAX_ATTEMPTS) { this.outAck.delete(key); continue; }
      void this.deps.trySendAck(a.to, a.id, a.kind).then((ok) => { if (ok) this.outAck.delete(key); });
    }
  }

  /** Golește toată starea (la deregister/wipe). */
  clear() {
    this.outbox = [];
    this.pendingAck.clear();
    this.outAck.clear();
    this.stopSweep();
  }
}
