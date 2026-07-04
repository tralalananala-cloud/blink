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
import { toB64, fromB64, utf8, fromUtf8, hash } from "../crypto/signal/primitives";
import { ctl, parseControl } from "./codec"; // codec de control E2E (Faza 3.2) — pur, testat
import { Outbox } from "./outbox"; // fiabilitatea livrării (Faza 3.2) — outbox/pendingAck/sweep

type IncomingCb = (fromDid: string, plaintext: string, remoteId?: string, senderName?: string) => void;
// M4 — sink = scriere streaming în fișier (nativ); parts = asamblare legacy în RAM (web/fallback)
type MediaAsm = { meta: any; n: number; parts: string[] | null; got: number; sink: MediaSink | null; seen: Set<number>; lastAt: number };

// T2 — un transfer media la care nu mai vine nicio bucată timp de atât e ABANDONAT curat
// (nu îngheață o intrare pe viață în RAM/fișier). Nu blochează textul: fiecare plic e tratat
// independent la primire, deci un text venit imediat după o media incompletă ajunge oricum.
const MEDIA_ASM_TTL_MS = 45000;

function myName(): string {
  return useApp.getState().settings.profileName?.trim() || "";
}

const isDev = typeof __DEV__ !== "undefined" ? __DEV__ : false;

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
  // v1.2.1 — înregistrare auto-vindecătoare: confirmare `ready` + watchdog de reconectare.
  private registered = false;   // am primit `ready` de la releu (reg confirmat)
  private regSent = false;      // am trimis deja reg pe ACEASTĂ conexiune (anti-dublu challenge)
  private regWatchdog: ReturnType<typeof setTimeout> | null = null;
  // Fiabilitatea livrării (outbox + pendingAck + outAck + sweep) — Faza 3.2. Transmiterea efectivă
  // e injectată (callback-uri spre metodele de mai jos). `pendingAck` e expus prin getter-ul de jos
  // (testele 1.3 inspectează `relay.pendingAck`).
  private outboxMgr = new Outbox({
    isConnected: () => this.connected,
    sendText: (to, text, id) => this.sendText(to, text, id),
    sendMedia: (to, att, id) => this.sendMedia(to, att, id),
    trySendAck: (to, id, kind) => this.trySendAck(to, id, kind),
  });
  // A1 Reticulum: did peer → adresa lui Reticulum (învățată din payload-ul mesajelor).
  private peerReticulum = new Map<string, string>();
  // qack: id-urile mesajelor din coada offline DECRIPTATE cu succes → se confirmă releului
  // (livrare at-least-once). Releul scoate din coadă doar ce confirmăm; restul re-livrează.
  private qackBuf = new Set<string>();
  private qackTimer: ReturnType<typeof setTimeout> | null = null;

  // #5 — debounce per contact pt bannerul „re-pair" (nu-l spamăm la replay/gunoi).
  private repairDebounce = new Map<string, number>();
  // #7 — amprente de plicuri deja procesate (LRU) → respinge replay/re-livrare duplicată.
  private seenEnv = new Map<string, number>();

  private envFp(env: any): string {
    return toB64(hash(utf8(env.sealed || env.ciphertext || "")));
  }
  private markSeen(fp: string): void {
    this.seenEnv.set(fp, Date.now());
    if (this.seenEnv.size > 600) { const k = this.seenEnv.keys().next().value; if (k) this.seenEnv.delete(k); }
  }
  // Expune coada de confirmări a outbox-ului (testele 1.3 inspectează `relay.pendingAck`).
  private get pendingAck() { return this.outboxMgr.pendingAck; }

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

  // Confirmă releului un mesaj din coada offline DUPĂ ce a fost decriptat+procesat → releul îl
  // scoate din coadă. Debounce 150ms ca să coaleseze o rafală (ex. 19 mesaje) într-un singur qack.
  private queueAck(qid: string) {
    this.qackBuf.add(qid);
    if (this.qackTimer) return;
    this.qackTimer = setTimeout(() => {
      this.qackTimer = null;
      const ids = [...this.qackBuf];
      this.qackBuf.clear();
      const did = this.myDid();
      if (this.connected && did && ids.length) {
        try { this.ws?.send(JSON.stringify({ t: "qack", did, ids })); } catch {}
      }
    }, 150);
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
      this.registered = false;
      this.regSent = false;
      this.startPing(); // keepalive ca să nu pice conexiunea
      // Auth releu (C1): CEREM activ challenge-ul (anti-race — nu ne bazăm pe push-ul de la releu,
      // care poate ajunge înainte să ascultăm). Releul răspunde cu {t:"challenge", nonce} → doRegister.
      try { ws.send(JSON.stringify({ t: "hello" })); } catch {}
      // Watchdog: dacă reg-ul nu se confirmă (`ready`) în 5s, reconectăm (challenge nou) —
      // așa NU mai e nevoie de restart manual după update (vezi bug v1.2.0).
      this.armRegWatchdog();
    };
    ws.onclose = () => {
      this.connected = false; this.registered = false; this.regSent = false;
      this.stopPing(); this.outboxMgr.stopSweep(); this.clearRegWatchdog(); this.scheduleRetry();
    };
    ws.onerror = () => {};
    ws.onmessage = (ev: any) => this.handle(ev.data);
  }

  /**
   * Auth releu (C1): la primirea challenge-ului, trimite reg-ul SEMNAT cu cheia de identitate
   * (engine.signChallenge). Releul verifică semnătura + că did === didFrom(idKey, authPub)
   * înainte de a accepta reg/dereg/push/qack → nimeni nu mai poate revendica DID-ul altcuiva.
   * Restul inițializării (push, sweep, outbox, Reticulum) pornește abia după ce reg-ul a plecat.
   */
  private doRegister(nonce: string) {
    if (this.regSent || !this.connected) return; // o singură dată per conexiune (push + hello pot dubla challenge-ul)
    const did = this.myDid();
    if (!did) return;
    // Construiește reg-ul DEFENSIV: dacă motorul nu-i încă gata (getBundle/signChallenge aruncă),
    // NU consuma tăcut challenge-ul — reconectează ca să vină unul nou când suntem gata.
    let bundle: any, auth: any, opks: any;
    try {
      bundle = engine.getBundle();
      auth = engine.signChallenge?.(nonce);
      opks = engine.getOpkBatch?.(); // #4 batch de one-time prekey-uri pt pool-ul releului
    } catch {
      try { this.ws?.close(); } catch {} // → onclose → scheduleRetry (challenge nou)
      return;
    }
    this.regSent = true;
    try { this.ws?.send(JSON.stringify({ t: "reg", did, bundle, ackq: true, auth, opks })); }
    catch { this.regSent = false; try { this.ws?.close(); } catch {}; }
    // Restul inițializării (push, sweep, outbox, Reticulum) se face la CONFIRMAREA `ready`.
  }

  /** Releul a confirmat înregistrarea (`ready`) → oprește watchdog-ul și pornește restul. */
  private onRegistered() {
    this.registered = true;
    this.clearRegWatchdog();
    const did = this.myDid();
    this.sendPush();
    this.outboxMgr.startSweep();
    this.outboxMgr.flush();
    if (RETICULUM_GATEWAY && did) {
      reticulum.register(did).then((addr) => {
        if (addr) reticulum.startPolling((blob) => { try { this.handle(fromUtf8(fromB64(blob))); } catch {} });
      });
    }
  }

  private armRegWatchdog() {
    this.clearRegWatchdog();
    this.regWatchdog = setTimeout(() => {
      if (!this.registered) { try { this.ws?.close(); } catch {} } // reg neconfirmat → reconectează
    }, 5000);
  }
  private clearRegWatchdog() {
    if (this.regWatchdog) { clearTimeout(this.regWatchdog); this.regWatchdog = null; }
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      try { this.ws?.send(JSON.stringify({ t: "ping" })); } catch {}
      this.sweepStaleMedia(); // T2 — abandonează transferurile media înghețate
    }, 25000);
  }
  private stopPing() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  /** T2 — mătură transferurile media incomplete la care n-a mai venit nimic de MEDIA_ASM_TTL_MS. */
  private sweepStaleMedia(now = Date.now()) {
    for (const [key, a] of this.mediaAsm) {
      if (now - a.lastAt > MEDIA_ASM_TTL_MS) {
        a.sink?.abort(); // eliberează fișierul parțial (dacă e sink nativ)
        this.mediaAsm.delete(key);
      }
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
    this.outboxMgr.clear();
    try { this.ws?.close(); } catch {}
    this.ws = null;
    this.connected = false;
    if (this.qackTimer) { clearTimeout(this.qackTimer); this.qackTimer = null; }
    this.qackBuf.clear();
    this.peerReticulum.clear();
    reticulum.stopPolling();
    this.mediaAsm.clear();
    this.waiters.clear();
    this.pushToken = null;
  }

  private async handle(raw: any) {
    let m: any;
    try { m = JSON.parse(typeof raw === "string" ? raw : raw.toString()); } catch { return; }
    if (m.t === "challenge" && m.nonce) { this.doRegister(m.nonce); return; } // auth releu (C1)
    if (m.t === "ready") { this.onRegistered(); return; } // reg confirmat → pornește restul (msg-urile din coadă vin separat)
    if (m.t === "denied") { if (isDev) console.warn("[Blink] releu a refuzat reg:", m.reason); this.regSent = false; return; }
    if (m.t === "bundle") {
      const w = this.waiters.get(m.did);
      if (w) {
        this.waiters.delete(m.did);
        const b = m.bundle ?? null;
        if (b && m.opk) b.opk = m.opk; // #4 one-time prekey POPat de releu pt acest contact
        w(b);
      }
      return;
    }
    if (m.t === "msg" && m.env) {
      const env = m.env as CipherEnvelope & { sealed?: string };
      const qid: string | undefined = m.qid; // prezent doar pt mesaje din coada offline (livrare confirmată)
      // #7 dedupe: plic deja procesat (replay sau re-livrare din coadă) → confirmă-l și ieși,
      // fără să-l reprocesăm sau să declanșăm bannere. (amprenta nu se reține decât pe succes.)
      const fp = this.envFp(env);
      if (this.seenEnv.has(fp)) { if (qid) this.queueAck(qid); return; }
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
        this.markSeen(fp); // #7 decriptat cu succes → reține amprenta (anti-replay)
        useApp.getState().clearNeedsRepair(env.fromDid); // decriptare reușită → relație sănătoasă
        // Commit livrare: decriptarea a reușit = ratchet-ul a avansat ireversibil, deci re-livrarea
        // aceluiași mesaj n-ar mai putea fi decriptată → confirmă releului să-l scoată din coadă.
        // Eșecul de decriptare (catch) NU confirmă → mesajul rămâne în coadă pt re-încercare.
        if (qid) this.queueAck(qid);
        const c = parseControl(plaintext); // codec pur (Faza 3.2) — clasifică mesajul de control
        switch (c.k) {
          case "a": // confirmare (bifă): urcă starea mesajului propriu
            useApp.getState().markMsgStatus(env.fromDid, c.id, c.s);
            this.outboxMgr.onDelivered(c.id); // confirmat → nu mai retrimite
            return;
          case "e": // editare de la peer
            useApp.getState().applyRemoteEdit(env.fromDid, c.id, c.b);
            return;
          case "d": // ștergere mesaj de la peer
            useApp.getState().applyRemoteDelete(env.fromDid, c.id);
            return;
          case "dc": // ștergere conversație de la peer
            useApp.getState().applyRemoteDeleteConv(env.fromDid);
            return;
          case "call": // semnalizare apel WebRTC (Faza 5)
            callManager.handleSignal(env.fromDid, c.sig);
            return;
          case "mh": { // antet media: pregătește reasamblarea — sink nativ (streaming) sau parts (legacy)
            const sink = createMediaSink(c.id, c.meta.kind, c.meta.name);
            this.mediaAsm.set(env.fromDid + ":" + c.id, {
              meta: c.meta, n: c.n, got: 0, sink, parts: sink ? null : new Array(c.n), seen: new Set(), lastAt: Date.now(),
            });
            return;
          }
          case "mc": { // bucată media: scrie în fișier (sink) sau în array (legacy); când e completă → mesaj
            const key = env.fromDid + ":" + c.id;
            const a = this.mediaAsm.get(key);
            if (!a || a.seen.has(c.i)) return; // dedupe după index
            try {
              if (a.sink) a.sink.writeChunk(c.i, c.d);
              else a.parts![c.i] = c.d;
            } catch { a.sink?.abort(); this.mediaAsm.delete(key); return; }
            a.seen.add(c.i);
            a.got++;
            a.lastAt = Date.now(); // transfer viu → resetează ceasul de abandon
            if (a.got >= a.n) {
              this.mediaAsm.delete(key);
              try {
                const uri = a.sink ? a.sink.finish() : await writeMedia(c.id, a.meta.kind, a.meta.name, a.parts!.join(""));
                const att: Attachment = { kind: a.meta.kind, uri, name: a.meta.name, size: a.meta.size, durationMs: a.meta.dur, width: a.meta.w, height: a.meta.h };
                useApp.getState().receiveMessage(env.fromDid, "", c.id, att, a.meta.n);
                this.sendAck(env.fromDid, c.id, "delivered");
              } catch { a.sink?.abort(); /* asamblare eșuată — renunță */ }
            }
            return;
          }
          case "t":
          case "raw": { // mesaj text (sau fallback de la un peer vechi, fără înveliș)
            const body = c.k === "t" ? (c.b ?? "") : c.b;
            const remoteId = c.k === "t" ? c.id : undefined;
            const senderName = c.k === "t" ? c.n : undefined;
            if (c.k === "t" && c.ra) this.peerReticulum.set(env.fromDid, c.ra); // învață adresa Reticulum a peer-ului
            this.incoming?.(env.fromDid, body, remoteId, senderName);
            if (remoteId) this.sendAck(env.fromDid, remoteId, "delivered"); // ✓✓ livrat, automat
            return;
          }
        }
      } catch {
        // #5 — marchează „re-pair" DOAR pt un contact cu care AVEM o sesiune (desincronizare
        // reală de ratchet), nu pentru plicuri gunoi/replay/spoof de la necunoscuți (altfel
        // oricine ne-ar putea spama bannerul trimițând plicuri invalide). Debounce 30s/contact.
        // env.fromDid e setat doar pt plicuri ne-sealed; la sealed eșuat nu știm expeditorul → ignorăm.
        const from = env.fromDid;
        if (from && engine.hasSession(from)) {
          const now = Date.now();
          if (now - (this.repairDebounce.get(from) || 0) > 30000) {
            this.repairDebounce.set(from, now);
            useApp.getState().flagNeedsRepair(from);
          }
        }
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
    if (!this.connected) { this.outboxMgr.queueOut({ to: peerDid, kind: "text", text: plaintext, id: msgId }); return { ok: true, reason: "queued" }; }
    const has = await this.ensureSession(peerDid);
    if (!has) return { ok: false, reason: "no-bundle" };
    const env = await this.encryptFor(peerDid, JSON.stringify(ctl.text(msgId, plaintext, myName(), reticulum.myAddr ?? undefined)));
    try { await this.transmit(peerDid, env); }
    catch { this.outboxMgr.queueOut({ to: peerDid, kind: "text", text: plaintext, id: msgId }); return { ok: false, reason: "send-failed" }; }
    useApp.getState().markMsgStatus(peerDid, msgId, "sent"); // ✓ predat releului
    this.outboxMgr.trackPending(msgId, { to: peerDid, kind: "text", text: plaintext });
    return { ok: true };
  }

  private async sendCtl(peerDid: string, obj: any): Promise<void> {
    const env = await this.encryptFor(peerDid, JSON.stringify(obj));
    await this.transmit(peerDid, env);
  }

  /** Trimite un atașament criptat E2E pe bucăți, STREAMING (M4 — fără tot fișierul în RAM). */
  async sendMedia(peerDid: string, att: Attachment, msgId: string): Promise<{ ok: boolean; reason?: string }> {
    if (!this.connected) { this.outboxMgr.queueOut({ to: peerDid, kind: "media", att, id: msgId }); return { ok: true, reason: "queued" }; }
    if (!(await this.ensureSession(peerDid))) return { ok: false, reason: "no-bundle" };
    let mhSent = false;
    try {
      const res = await streamFileChunks(att.uri, async (b64, i, total) => {
        if (!mhSent) {
          const meta = { kind: att.kind, name: att.name, dur: att.durationMs, w: att.width, h: att.height, size: att.size, n: myName() };
          await this.sendCtl(peerDid, ctl.mediaHeader(msgId, total, meta));
          mhSent = true;
        }
        await this.sendCtl(peerDid, ctl.mediaChunk(msgId, i, b64));
      });
      if (!res) return { ok: false, reason: "too-big" };
    } catch {
      return { ok: false, reason: "send-failed" };
    }
    useApp.getState().markMsgStatus(peerDid, msgId, "sent");
    this.outboxMgr.trackPending(msgId, { to: peerDid, kind: "media", att });
    return { ok: true };
  }

  /** Trimite o confirmare (livrat/citit) criptată E2E. */
  async sendAck(peerDid: string, id: string, kind: "delivered" | "read"): Promise<void> {
    const ok = await this.trySendAck(peerDid, id, kind);
    if (!ok) {
      // n-a putut pleca acum (offline / sesiune de răspuns nepregătită la flush) → re-încearcă în sweep
      this.outboxMgr.retryOutAck(peerDid, id, kind);
    }
  }

  // O singură încercare de a trimite o confirmare; întoarce true doar dacă a plecat efectiv.
  private async trySendAck(peerDid: string, id: string, kind: "delivered" | "read"): Promise<boolean> {
    if (!this.connected) return false;
    if (!(await this.ensureSession(peerDid))) return false;
    try {
      const env = await this.encryptFor(peerDid, JSON.stringify(ctl.ack(id, kind)));
      await this.transmit(peerDid, env);
      return true;
    } catch { return false; }
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
  sendEdit(peerDid: string, msgId: string, text: string) { return this.sendControl(peerDid, ctl.edit(msgId, text)); }
  /** Anunță peer-ul să șteargă un mesaj de la tine. */
  sendDeleteMsg(peerDid: string, msgId: string) { return this.sendControl(peerDid, ctl.delMsg(msgId)); }
  /** Anunță peer-ul să șteargă întreaga conversație cu tine. */
  sendDeleteConv(peerDid: string) { return this.sendControl(peerDid, ctl.delConv()); }
  /** Trimite un semnal de apel WebRTC (offer/answer/ice/end) criptat E2E. */
  sendCallSignal(peerDid: string, sig: any) { return this.sendControl(peerDid, ctl.call(sig)); }
}

export const relay = new Relay();
// Cablează semnalizarea apelurilor: callManager trimite prin releu (criptat E2E).
callManager.setSignalSender((peerDid, sig) => { void relay.sendCallSignal(peerDid, sig); });
