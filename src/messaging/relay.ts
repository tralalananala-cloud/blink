/**
 * Strat de mesagerie peste releul oarb (Faza 2).
 * Ține conexiunea WebSocket, publică bundle-ul propriu, aduce bundle-urile
 * altora, stabilește sesiuni reale (X3DH) și criptează/decriptează E2E.
 * Releul vede DOAR plicuri sigilate + chei publice.
 *
 * Plaintext-ul interior e un mic JSON de control E2E:
 *   { k:"t", id, b }            mesaj text (id = id-ul la expeditor)
 *   { k:"a", id, s:"delivered"|"read" }   confirmare (bife ✓✓)
 */
import { engine } from "../crypto";
import { CipherEnvelope, SerializedBundle } from "../crypto/types";
import { useApp } from "../state/store";
import { RELAY_URL, RELAY_HTTP, RETICULUM_GATEWAY } from "../config";
import { Attachment } from "../data/mockData";
import { createMediaSink, MediaSink, streamFileChunks, writeMedia } from "../media/wire";
import { callManager } from "../calls/webrtc";
import { reticulum } from "./reticulum";
import { toB64, fromB64, utf8, fromUtf8 } from "../crypto/signal/primitives";

type IncomingCb = (fromDid: string, plaintext: string, remoteId?: string, senderName?: string) => void;
// M4 — sink = scriere streaming în fișier (nativ); parts = asamblare legacy în RAM (web/fallback)
type MediaAsm = { meta: any; n: number; parts: string[] | null; got: number; sink: MediaSink | null; seen: Set<number> };

function myName(): string {
  return useApp.getState().settings.profileName?.trim() || "";
}

const isDev = typeof __DEV__ !== "undefined" ? __DEV__ : false;

const ACK_TIMEOUT = 6000;    // cât așteptăm un „delivered" înainte de a retrimite mesajul
const ACK_MAX_ATTEMPTS = 4;  // câte resend-uri încercăm înainte de a renunța (rămâne la ✓, onest)

class Relay {
  private ws: WebSocket | null = null;
  private connected = false;
  private incoming: IncomingCb | null = null;
  private waiters = new Map<string, (b: SerializedBundle | null) => void>();
  private url = RELAY_URL;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private mediaAsm = new Map<string, MediaAsm>(); // reasamblare media: `${fromDid}:${id}` → bucăți
  private pushToken: string | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  // outbox: mesaje de trimis care așteaptă (re)conectarea — nu se pierd la conexiune capricioasă
  private outbox: Array<{ to: string; kind: "text" | "media"; text?: string; att?: Attachment; id: string }> = [];
  // pendingAck: mesaje PREDATE releului dar fără confirmare „delivered" — se RETRIMIT pe timeout.
  // Rezolvă socketul-zombi după re-pair/reconectare (releul zice LIVRAT-LIVE pe un socket mort →
  // mesajul nu ajunge → fără resend ar rămâne la o singură bifă până la restart manual).
  private pendingAck = new Map<string, { to: string; kind: "text" | "media"; text?: string; att?: Attachment; attempts: number; nextAt: number }>();
  private ackTimer: ReturnType<typeof setInterval> | null = null;
  // A1 Reticulum: did peer → adresa lui Reticulum (învățată din payload-ul mesajelor).
  private peerReticulum = new Map<string, string>();

  setUrl(u: string) { this.url = u; }
  isConnected() { return this.connected; }
  onMessage(cb: IncomingCb) { this.incoming = cb; }

  /** Înregistrează token-ul de push (FCM) la releu, pt notificări cu app închis. */
  registerPush(token: string) {
    this.pushToken = token;
    this.sendPush();
  }
  private sendPush() {
    const did = this.myDid();
    if (this.connected && did && this.pushToken) {
      try { this.ws!.send(JSON.stringify({ t: "push", did, token: this.pushToken })); } catch {}
    }
  }

  private myDid(): string | null {
    return useApp.getState().identity?.did ?? null;
  }

  connect() {
    const did = this.myDid();
    if (!did) return; // fără identitate încă
    // Gardă TLS (Faza 0): în producție refuză releu necriptat (ws://), cu excepția localhost dev.
    if (!isDev && this.url.startsWith("ws://") && !/127\.0\.0\.1|localhost/.test(this.url)) {
      console.warn("[Blink] Releu necriptat (ws://) blocat în producție — folosește wss://.");
      return;
    }
    // Gardă: dacă există deja o conexiune în curs/deschisă, nu o dubla (altfel reconectări în loop).
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return;
    // Sharding releu: trimitem DID-ul în URL ca worker-ul să rutere conexiunea pe
    // „shard-ul de casă" al userului (idFromName(did)) → capacitate de conexiuni simultane
    // distribuită pe multe Durable Objects, nu un singur hub global.
    const shardUrl = this.url + (this.url.includes("?") ? "&" : "?") + "did=" + encodeURIComponent(did);
    let ws: WebSocket;
    try { ws = new WebSocket(shardUrl); } catch { this.scheduleRetry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      try { ws.send(JSON.stringify({ t: "reg", did, bundle: engine.getBundle() })); } catch {}
      this.sendPush(); // re-trimite token-ul de push la (re)conectare
      this.startPing(); // keepalive ca să nu pice conexiunea
      this.startAckSweep(); // retrimite mesajele neconfirmate (anti socket-zombi)
      this.flushOutbox(); // trimite ce s-a acumulat cât eram offline
      // A1 Reticulum (opțional): înregistrează-te la gateway + ascultă inbox-ul (transport orb).
      if (RETICULUM_GATEWAY) {
        reticulum.register(did).then((addr) => {
          if (addr) reticulum.startPolling((blob) => { try { this.handle(fromUtf8(fromB64(blob))); } catch {} });
        });
      }
    };
    ws.onclose = () => { this.connected = false; this.stopPing(); this.stopAckSweep(); this.scheduleRetry(); };
    ws.onerror = () => {};
    ws.onmessage = (ev: any) => this.handle(ev.data);
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      try { this.ws?.send(JSON.stringify({ t: "ping" })); } catch {}
    }, 25000);
  }
  private stopPing() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  // Reține un mesaj predat releului până vine „delivered". La resend (intrarea există deja)
  // PĂSTRĂM attempts/nextAt (setate de sweep) — altfel s-ar reseta și ar retrimite la infinit.
  private trackPending(id: string, item: { to: string; kind: "text" | "media"; text?: string; att?: Attachment }) {
    const ex = this.pendingAck.get(id);
    if (ex) { ex.to = item.to; ex.kind = item.kind; ex.text = item.text; ex.att = item.att; return; }
    this.pendingAck.set(id, { ...item, attempts: 0, nextAt: Date.now() + ACK_TIMEOUT });
  }

  private startAckSweep() {
    this.stopAckSweep();
    this.ackTimer = setInterval(() => this.ackSweep(), 3000);
  }
  private stopAckSweep() {
    if (this.ackTimer) { clearInterval(this.ackTimer); this.ackTimer = null; }
  }
  // Retrimite mesajele neconfirmate ajunse la timeout (același msgId → receptorul face dedupe).
  private ackSweep() {
    if (!this.connected || this.pendingAck.size === 0) return;
    const now = Date.now();
    for (const [id, p] of this.pendingAck) {
      if (now < p.nextAt) continue;
      if (p.attempts >= ACK_MAX_ATTEMPTS) { this.pendingAck.delete(id); continue; } // renunță (rămâne ✓)
      p.attempts++;
      p.nextAt = now + ACK_TIMEOUT * Math.pow(1.8, p.attempts); // backoff
      if (p.kind === "text") void this.sendText(p.to, p.text!, id);
      else if (p.att) void this.sendMedia(p.to, p.att, id);
    }
  }

  private flushOutbox() {
    if (!this.outbox.length) return;
    const items = this.outbox;
    this.outbox = [];
    for (const it of items) {
      if (it.kind === "text") this.sendText(it.to, it.text!, it.id);
      else if (it.att) this.sendMedia(it.to, it.att, it.id);
    }
  }

  private scheduleRetry() {
    if (this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; this.connect(); }, 3000);
  }

  /**
   * B2 — la wipe: anunță releul să șteargă DID-ul vechi (bundle + coadă + push token),
   * apoi rupe conexiunea și golește toată starea locală a transportului.
   */
  deregister() {
    const did = this.myDid();
    try { if (this.connected && did) this.ws?.send(JSON.stringify({ t: "dereg", did })); } catch {}
    if (this.retry) { clearTimeout(this.retry); this.retry = null; }
    this.stopPing();
    this.stopAckSweep();
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.connected = false;
    this.outbox = [];
    this.pendingAck.clear();
    this.peerReticulum.clear();
    reticulum.stopPolling();
    this.mediaAsm.clear();
    this.waiters.clear();
    this.pushToken = null;
  }

  private async handle(raw: any) {
    let m: any;
    try { m = JSON.parse(typeof raw === "string" ? raw : raw.toString()); } catch { return; }
    if (m.t === "bundle") {
      const w = this.waiters.get(m.did);
      if (w) { this.waiters.delete(m.did); w(m.bundle ?? null); }
      return;
    }
    if (m.t === "msg" && m.env) {
      const env = m.env as CipherEnvelope & { sealed?: string };
      try {
        let plaintext: string;
        if (env.sealed && engine.decryptSealed) {
          // sealed sender (#2): află expeditorul DOAR după decriptare; setează env.fromDid
          // ca restul logicii (care citește env.fromDid) să meargă neschimbat.
          const r = await engine.decryptSealed({ toDid: "", sealed: env.sealed, ts: env.ts });
          plaintext = r.plaintext;
          env.fromDid = r.fromDid;
        } else {
          plaintext = (await engine.decrypt(env)).plaintext;
        }
        useApp.getState().clearNeedsRepair(env.fromDid); // decriptare reușită → relație sănătoasă
        let parsed: any = null;
        try { parsed = JSON.parse(plaintext); } catch {}
        if (parsed && parsed.k === "a" && parsed.id) {
          // confirmare (bifă): urcă starea mesajului propriu
          const status = parsed.s === "read" ? "read" : "delivered";
          useApp.getState().markMsgStatus(env.fromDid, parsed.id, status);
          this.pendingAck.delete(parsed.id); // confirmat → nu mai retrimite
          return;
        }
        if (parsed && parsed.k === "e" && parsed.id) { // editare de la peer
          useApp.getState().applyRemoteEdit(env.fromDid, parsed.id, parsed.b ?? "");
          return;
        }
        if (parsed && parsed.k === "d" && parsed.id) { // ștergere mesaj de la peer
          useApp.getState().applyRemoteDelete(env.fromDid, parsed.id);
          return;
        }
        if (parsed && parsed.k === "dc") { // ștergere conversație de la peer
          useApp.getState().applyRemoteDeleteConv(env.fromDid);
          return;
        }
        if (parsed && parsed.k === "call" && parsed.sig) { // semnalizare apel WebRTC (Faza 5)
          callManager.handleSignal(env.fromDid, parsed.sig);
          return;
        }
        if (parsed && parsed.k === "mh" && parsed.id) {
          // antet media: pregătește reasamblarea — sink nativ (streaming) sau parts (legacy)
          const meta = parsed.meta || {};
          const sink = createMediaSink(parsed.id, meta.kind, meta.name);
          this.mediaAsm.set(env.fromDid + ":" + parsed.id, {
            meta, n: parsed.n, got: 0, sink, parts: sink ? null : new Array(parsed.n), seen: new Set(),
          });
          return;
        }
        if (parsed && parsed.k === "mc" && parsed.id) {
          // bucată media: scrie în fișier (sink) sau în array (legacy); când e completă → mesaj
          const key = env.fromDid + ":" + parsed.id;
          const a = this.mediaAsm.get(key);
          if (!a || a.seen.has(parsed.i)) return; // dedupe după index
          try {
            if (a.sink) a.sink.writeChunk(parsed.i, parsed.d);
            else a.parts![parsed.i] = parsed.d;
          } catch { a.sink?.abort(); this.mediaAsm.delete(key); return; }
          a.seen.add(parsed.i);
          a.got++;
          if (a.got >= a.n) {
            this.mediaAsm.delete(key);
            try {
              const uri = a.sink ? a.sink.finish() : await writeMedia(parsed.id, a.meta.kind, a.meta.name, a.parts!.join(""));
              const att: Attachment = { kind: a.meta.kind, uri, name: a.meta.name, size: a.meta.size, durationMs: a.meta.dur, width: a.meta.w, height: a.meta.h };
              useApp.getState().receiveMessage(env.fromDid, "", parsed.id, att, a.meta.n);
              this.sendAck(env.fromDid, parsed.id, "delivered");
            } catch { a.sink?.abort(); /* asamblare eșuată — renunță */ }
          }
          return;
        }
        // mesaj text (sau fallback dacă vine de la un peer vechi, fără înveliș)
        const body = parsed && parsed.k === "t" ? parsed.b : plaintext;
        const remoteId = parsed && parsed.k === "t" ? parsed.id : undefined;
        const senderName = parsed && parsed.k === "t" ? parsed.n : undefined;
        if (parsed && parsed.ra) this.peerReticulum.set(env.fromDid, parsed.ra); // învață adresa Reticulum a peer-ului
        this.incoming?.(env.fromDid, body, remoteId, senderName);
        if (remoteId) this.sendAck(env.fromDid, remoteId, "delivered"); // ✓✓ livrat, automat
      } catch {
        // B2 — decriptare eșuată de la un contact cunoscut = probabil și-a resetat
        // identitatea (chei noi, sesiune ratchet incompatibilă). Marchează → banner re-pair.
        useApp.getState().flagNeedsRepair(env.fromDid);
      }
    }
  }

  fetchBundle(did: string): Promise<SerializedBundle | null> {
    return new Promise((resolve) => {
      if (!this.ws || !this.connected) return resolve(null);
      this.waiters.set(did, resolve);
      try { this.ws.send(JSON.stringify({ t: "getbundle", did })); } catch { resolve(null); }
      setTimeout(() => { if (this.waiters.delete(did)) resolve(null); }, 4000);
    });
  }

  async ensureSession(peerDid: string): Promise<boolean> {
    if (engine.hasSession(peerDid)) return true;
    const b = await this.fetchBundle(peerDid);
    if (!b) return false;
    await engine.startOutbound(peerDid, b);
    return true;
  }

  private queueOut(item: { to: string; kind: "text" | "media"; text?: string; att?: Attachment; id: string }) {
    if (!this.outbox.some((x) => x.id === item.id)) this.outbox.push(item); // dedupe după id
  }

  /** Sealed sender activ? (toggle settings + motor care suportă). */
  private sealedOn(): boolean {
    return !!useApp.getState().settings.sealedSender && !!engine.encryptSealed;
  }

  /** Criptează un payload — sealed (ascunde expeditorul) dacă e activat, altfel normal. */
  private async encryptFor(peerDid: string, payload: string): Promise<any> {
    if (this.sealedOn()) return await engine.encryptSealed!(peerDid, payload);
    return await engine.encrypt(peerDid, payload);
  }

  /** Trimite plicul: sealed → HTTP POST ANONIM (releul nu vede expeditorul); altfel → WS. */
  private async transmit(peerDid: string, env: any): Promise<void> {
    // A1: dacă știm adresa Reticulum a peer-ului, rutează DESCENTRALIZAT prin gateway
    // (blob opac = plicul E2E; nodurile nu-l văd). Fallback la releu dacă eșuează.
    if (RETICULUM_GATEWAY && this.peerReticulum.has(peerDid)) {
      const blob = toB64(utf8(JSON.stringify({ t: "msg", env })));
      if (await reticulum.send(this.peerReticulum.get(peerDid)!, blob)) return;
    }
    if (env.sealed) {
      const res = await fetch(RELAY_HTTP + "/send", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: peerDid, env }),
      });
      if (!res.ok) throw new Error("HTTP /send status " + res.status);
    } else {
      this.ws!.send(JSON.stringify({ t: "send", to: peerDid, env }));
    }
  }

  /** Trimite un text criptat E2E către un DID; msgId leagă bifele de confirmare. */
  async sendText(peerDid: string, plaintext: string, msgId: string): Promise<{ ok: boolean; reason?: string }> {
    if (!this.connected) { this.queueOut({ to: peerDid, kind: "text", text: plaintext, id: msgId }); return { ok: true, reason: "queued" }; }
    const has = await this.ensureSession(peerDid);
    if (!has) return { ok: false, reason: "no-bundle" };
    const env = await this.encryptFor(peerDid, JSON.stringify({ k: "t", id: msgId, b: plaintext, n: myName(), ra: reticulum.myAddr ?? undefined }));
    try { await this.transmit(peerDid, env); }
    catch { this.queueOut({ to: peerDid, kind: "text", text: plaintext, id: msgId }); return { ok: false, reason: "send-failed" }; }
    useApp.getState().markMsgStatus(peerDid, msgId, "sent"); // ✓ predat releului
    this.trackPending(msgId, { to: peerDid, kind: "text", text: plaintext });
    return { ok: true };
  }

  private async sendCtl(peerDid: string, obj: any): Promise<void> {
    const env = await this.encryptFor(peerDid, JSON.stringify(obj));
    await this.transmit(peerDid, env);
  }

  /** Trimite un atașament criptat E2E pe bucăți, STREAMING (M4 — fără tot fișierul în RAM). */
  async sendMedia(peerDid: string, att: Attachment, msgId: string): Promise<{ ok: boolean; reason?: string }> {
    if (!this.connected) { this.queueOut({ to: peerDid, kind: "media", att, id: msgId }); return { ok: true, reason: "queued" }; }
    if (!(await this.ensureSession(peerDid))) return { ok: false, reason: "no-bundle" };
    let mhSent = false;
    try {
      const res = await streamFileChunks(att.uri, async (b64, i, total) => {
        if (!mhSent) {
          const meta = { kind: att.kind, name: att.name, dur: att.durationMs, w: att.width, h: att.height, size: att.size, n: myName() };
          await this.sendCtl(peerDid, { k: "mh", id: msgId, n: total, meta });
          mhSent = true;
        }
        await this.sendCtl(peerDid, { k: "mc", id: msgId, i, d: b64 });
      });
      if (!res) return { ok: false, reason: "too-big" };
    } catch {
      return { ok: false, reason: "send-failed" };
    }
    useApp.getState().markMsgStatus(peerDid, msgId, "sent");
    this.trackPending(msgId, { to: peerDid, kind: "media", att });
    return { ok: true };
  }

  /** Trimite o confirmare (livrat/citit) criptată E2E. */
  async sendAck(peerDid: string, id: string, kind: "delivered" | "read"): Promise<void> {
    if (!this.connected) return;
    if (!(await this.ensureSession(peerDid))) return;
    const env = await this.encryptFor(peerDid, JSON.stringify({ k: "a", id, s: kind }));
    try { await this.transmit(peerDid, env); } catch {}
  }

  /** La deschiderea conversației: confirmă „citit" pt mesajele primite ne-confirmate. */
  async sendReadReceipts(peerDid: string): Promise<void> {
    const ids = useApp.getState().takeReadReceipts(peerDid);
    for (const id of ids) await this.sendAck(peerDid, id, "read");
  }

  /** Comandă de control (editare/ștergere) către peer — best effort (E2E). */
  private async sendControl(peerDid: string, obj: any): Promise<void> {
    if (!this.connected) return;
    if (!(await this.ensureSession(peerDid))) return;
    try { await this.sendCtl(peerDid, obj); } catch {}
  }
  /** Anunță peer-ul că ai editat un mesaj (msgId = id-ul tău local). */
  sendEdit(peerDid: string, msgId: string, text: string) { return this.sendControl(peerDid, { k: "e", id: msgId, b: text }); }
  /** Anunță peer-ul să șteargă un mesaj de la tine. */
  sendDeleteMsg(peerDid: string, msgId: string) { return this.sendControl(peerDid, { k: "d", id: msgId }); }
  /** Anunță peer-ul să șteargă întreaga conversație cu tine. */
  sendDeleteConv(peerDid: string) { return this.sendControl(peerDid, { k: "dc" }); }
  /** Trimite un semnal de apel WebRTC (offer/answer/ice/end) criptat E2E. */
  sendCallSignal(peerDid: string, sig: any) { return this.sendControl(peerDid, { k: "call", sig }); }
}

export const relay = new Relay();
// Cablează semnalizarea apelurilor: callManager trimite prin releu (criptat E2E).
callManager.setSignalSender((peerDid, sig) => { void relay.sendCallSignal(peerDid, sig); });
