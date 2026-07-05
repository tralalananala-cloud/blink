/**
 * Blink relay pe Cloudflare Workers + Durable Object.
 *
 * RELEU OARB — identic semantic cu server.js (Node):
 *   → { t:"reg", did, bundle }   inregistreaza + publica bundle, livreaza coada
 *   ← { t:"ready", queued:N }
 *   → { t:"getbundle", did }     ← { t:"bundle", did, bundle }
 *   → { t:"send", to, env }      ← { t:"msg", env }   (store-and-forward daca offline)
 *   → { t:"ping" }               ← { t:"pong" }
 *
 * Diferenta fata de Node: cozile + bundle-urile sunt in DO storage (SQLite) =>
 * supravietuiesc reporniri (rezolva si partea de releu din Faza 1).
 * Conexiunile folosesc WebSocket Hibernation API (eficient, nu tine DO in RAM cand e idle).
 *
 * SHARDING (capacitate conexiuni simultane): in loc de UN singur DO ("global-relay")
 * care strange TOATE conexiunile (= un singur isolate = plafon de conexiuni simultane),
 * fiecare user are un "shard de casa" = idFromName("shard:"+DID). Acolo ii traieste
 * socketul + coada + bundle + push token. Worker-ul ruteaza:
 *   - upgrade WebSocket  → shard("did" din query) = shardul userului
 *   - POST /send (sealed)→ shard(body.to)          = shardul destinatarului
 * Livrarea/getbundle catre alt user sare cross-shard prin stub.fetch intre DO-uri.
 * => conexiunile se imprastie pe mii de obiecte, capacitatea simultana creste mult.
 */

import { verifyReg } from "./auth.mjs"; // AUTH RELEU (C1) — helperi puri, testați (test/auth.test.mjs)
import { enqueue, pruneFresh, removeAcked, MAX_QUEUE, TTL } from "./queue.mjs"; // COADĂ at-least-once — pur, testat (test/queue.test.mjs)
import { buildServiceJwt, buildPushMessage, shouldPush } from "./push.mjs"; // PUSH FCM — helperi puri, testați (test/push.test.mjs, test/push_collapse.test.mjs)
import { bucketHit } from "./ratelimit.mjs"; // token-bucket pur, testat (test/ratelimit.test.mjs)

const shardName = (did) => "shard:" + did;
// #5 anti-abuz: rate-limit/dest (anti-flood). Generos, ca să nu afecteze conversațiile
// normale; oprește doar inundațiile de spam. (Plafonul cozii MAX_QUEUE e în queue.mjs.)
const RL_MAX = 240;        // mesaje
const RL_WINDOW = 60_000;  // pe minut, per destinatar
// #B1 anti-drenare pool OPK: getbundle e anonim (sealed sender), dar fără limită cineva care-ți
// știe DID-ul îți POPează tot poolul de one-time prekey-uri în câteva secunde → contactele noi
// cad pe prekey-ul last-resort (reutilizabil) = forward secrecy mai slabă. Limită per DID cerut.
const OPK_RL_MAX = 30;            // POP-uri de one-time prekey
const OPK_RL_WINDOW = 3_600_000;  // pe oră, per DID cerut

export class Relay {
  constructor(state, env) {
    this.state = state;
    this.storage = state.storage;
    this.env = env;
    this.fcmAt = null;
    this.fcmAtExp = 0;
    this.rl = new Map(); // #5 rate-limit per destinatar (in-memory pe shard)
    this.opkRl = new Map(); // #B1 rate-limit POP-uri OPK per DID cerut (in-memory pe shard)
  }

  // #5 — true dacă `to` a depășit pragul de mesaje în fereastra de timp (anti-flood).
  rateLimited(to) {
    const now = Date.now();
    const hist = (this.rl.get(to) || []).filter((t) => now - t < RL_WINDOW);
    if (hist.length >= RL_MAX) { this.rl.set(to, hist); return true; }
    hist.push(now);
    this.rl.set(to, hist);
    return false;
  }

  // gaseste socketul VIU (deschis) al unui DID; sare peste cele moarte/in inchidere
  // (altfel livram pe un socket stale dupa reconectare => false "LIVRAT-LIVE", mesaj pierdut)
  socketFor(did) {
    for (const ws of this.state.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (!a || a.did !== did) continue;
      if (ws.readyState !== undefined && ws.readyState !== 1 /* OPEN */) continue;
      return ws;
    }
    return null;
  }

  // La reconectare: inchide orice socket vechi al aceluiasi DID, ca sa ramana exact unul viu.
  closeStale(did, keep) {
    for (const ws of this.state.getWebSockets()) {
      if (ws === keep) continue;
      const a = ws.deserializeAttachment();
      if (a && a.did === did) { try { ws.close(1000, "replaced"); } catch {} }
    }
  }

  // Livrare comună (WS sau HTTP): trimite live la socketul destinatarului, altfel coadă + push.
  async deliver(to, env) {
    if (this.rateLimited(to)) return false; // #5 anti-flood (fără log — zero metadate)
    const dest = this.socketFor(to);
    let live = false;
    if (dest) {
      try { dest.send(JSON.stringify({ t: "msg", env })); live = true; } catch { live = false; }
    }
    if (!live) {
      const q = (await this.storage.get("queue:" + to)) || [];
      // #5 plafonat la MAX_QUEUE (cele mai vechi cad); id stabil pt confirmare per-mesaj (qack)
      const q2 = enqueue(q, { id: crypto.randomUUID(), env, ts: Date.now() });
      await this.storage.put("queue:" + to, q2);
      await this.pushNotify(to);
    }
    return live;
  }

  // True dacă ACEST DO e shardul de casă al lui `did` (unde-i traieste socketul/coada/bundle).
  ownsLocally(did) {
    return this.state.id.toString() === this.env.RELAY.idFromName(shardName(did)).toString();
  }

  // Livreaza `env` catre `to`: local daca-i pe shardul asta, altfel forward pe shardul lui `to`.
  async deliverRouted(to, env) {
    if (this.ownsLocally(to)) return this.deliver(to, env);
    const stub = this.env.RELAY.get(this.env.RELAY.idFromName(shardName(to)));
    try {
      const res = await stub.fetch("https://relay/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, env }),
      });
      const j = await res.json();
      return !!j.live;
    } catch { return false; }
  }

  // #B1 — true dacă poolul lui `did` a fost POPat de prea multe ori în fereastră (anti-drenare).
  opkRateLimited(did) {
    const r = bucketHit(this.opkRl.get(did), Date.now(), OPK_RL_MAX, OPK_RL_WINDOW);
    this.opkRl.set(did, r.hist);
    return r.limited;
  }

  // #4 — POPează un one-time prekey din poolul lui `did` (consumat: fiecare contact ia altul).
  async popOpkLocal(did) {
    // #B1: peste prag → NU POP (întoarce null) → clientul cade pe last-resort, nu eroare.
    // Contactele oneste (câteva/oră) nu ating pragul; drenarea în masă e oprită.
    if (this.opkRateLimited(did)) return null;
    const list = (await this.storage.get("opks:" + did)) || [];
    if (!list.length) return null;
    const opk = list.shift();
    await this.storage.put("opks:" + did, list);
    return opk;
  }

  // Bundle-ul lui `did` traieste pe shardul lui: citeste local (+ POP opk) sau cere cross-shard.
  async bundleRouted(did) {
    if (this.ownsLocally(did)) {
      return { bundle: (await this.storage.get("bundle:" + did)) || null, opk: await this.popOpkLocal(did) };
    }
    const stub = this.env.RELAY.get(this.env.RELAY.idFromName(shardName(did)));
    try {
      const res = await stub.fetch("https://relay/bundle?did=" + encodeURIComponent(did));
      const j = await res.json();
      return { bundle: j.bundle || null, opk: j.opk || null };
    } catch { return { bundle: null, opk: null }; }
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/health") {
      const online = this.state.getWebSockets().length;
      return new Response(JSON.stringify({ ok: true, online }), {
        headers: { "content-type": "application/json" },
      });
    }
    // Intern (cross-shard): citește bundle-ul unui DID pe care ACEST shard îl deține.
    if (url.pathname === "/bundle") {
      const did = url.searchParams.get("did");
      const b = did ? ((await this.storage.get("bundle:" + did)) || null) : null;
      const opk = did ? await this.popOpkLocal(did) : null; // #4 POP cross-shard
      return new Response(JSON.stringify({ bundle: b, opk }), { headers: { "content-type": "application/json" } });
    }
    // SEALED SENDER (#2): trimitere ANONIMĂ prin HTTP — releul NU află expeditorul
    // (niciun reg, niciun socket asociat; doar `to` pt rutare + blob opac). Decuplează
    // trimiterea de identitatea conexiunii. Anti-abuz: rate-limit + cap coadă în deliver().
    if (url.pathname === "/send" && req.method === "POST") {
      let body;
      try { body = await req.json(); } catch { return new Response("bad", { status: 400 }); }
      if (!body || !body.to || !body.env) return new Response("missing", { status: 400 });
      const live = await this.deliver(body.to, body.env);
      return new Response(JSON.stringify({ ok: true, live }), { headers: { "content-type": "application/json" } });
    }
    if ((req.headers.get("Upgrade") || "").toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.state.acceptWebSocket(server); // hibernatable
      // AUTH (C1): emite un nonce de challenge; reg-ul trebuie să-l semneze. Nonce-ul stă
      // pe atașamentul socketului (supraviețuiește hibernării) până la reg.
      const nonce = crypto.randomUUID();
      server.serializeAttachment({ nonce });
      try { server.send(JSON.stringify({ t: "challenge", nonce })); } catch {}
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response("blink-relay\n");
  }

  async webSocketMessage(ws, raw) {
    let m;
    try {
      m = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }

    // v1.2.1 — challenge inițiat de client (anti-race): clientul cere challenge-ul când e gata
    // să-l asculte; re-trimitem nonce-ul deja stocat pe socket (NU regenerăm → fără mismatch
    // cu un push anterior). Push-ul de la conectare rămâne pt clienții 1.2.0.
    if (m.t === "hello") {
      const a = ws.deserializeAttachment();
      if (a && a.nonce) ws.send(JSON.stringify({ t: "challenge", nonce: a.nonce }));
      return;
    }

    if (m.t === "reg" && m.did) {
      // AUTH (C1): reg-ul TREBUIE să dovedească proprietatea DID-ului (semnătură peste nonce).
      const att0 = ws.deserializeAttachment() || {};
      const ok = await verifyReg(m.did, m.bundle && m.bundle.ls, m.auth, att0.nonce);
      if (!ok) { try { ws.send(JSON.stringify({ t: "denied", reason: "auth" })); ws.close(1008, "auth"); } catch {} return; }
      ws.serializeAttachment({ did: m.did, authed: true }); // socket autentificat (nonce consumat)
      this.closeStale(m.did, ws); // reconectare: scapa de socketul vechi (anti false LIVRAT-LIVE)
      await this.storage.delete("pushed:" + m.did); // T4 — a revenit online → resetează notify-once (poate re-notifica la următoarea perioadă offline)
      if (m.bundle) await this.storage.put("bundle:" + m.did, m.bundle);
      if (Array.isArray(m.opks)) {
        // #4 pool de one-time prekey-uri: ÎNLOCUIEȘTE cu batch-ul curent (clientul îl are sigur
        // în store). Append-ul (≤1.2.0) lăsa releul să POPeze opk-uri pe care clientul le tăiase
        // → prekey message cu un opk inexistent → handshake eșuat la contacte noi. (v1.2.1)
        await this.storage.put("opks:" + m.did, m.opks.slice(0, 200));
      }
      const q = (await this.storage.get("queue:" + m.did)) || [];
      // păstrează coada ne-expirată (TTL) + backfill id; NU o șterge la reg (at-least-once)
      const fresh = pruneFresh(q, Date.now());
      if (m.ackq) {
        // LIVRARE AT-LEAST-ONCE: NU șterge coada la reg — păstreaz-o până vine `qack`-ul
        // (confirmare per mesaj, după decriptare reușită pe client). Ce nu se confirmă se
        // re-livrează la următoarea reconectare. Curăță doar intrările expirate (TTL).
        if (fresh.length) await this.storage.put("queue:" + m.did, fresh);
        else await this.storage.delete("queue:" + m.did);
        ws.send(JSON.stringify({ t: "ready", queued: fresh.length }));
        for (const x of fresh) ws.send(JSON.stringify({ t: "msg", env: x.env, qid: x.id }));
      } else {
        // client vechi (fără capabilitate ack) → comportament legacy delete-on-reg
        await this.storage.delete("queue:" + m.did);
        ws.send(JSON.stringify({ t: "ready", queued: fresh.length }));
        for (const x of fresh) ws.send(JSON.stringify({ t: "msg", env: x.env }));
      }
      return;
    }

    if (m.t === "qack" && m.did && Array.isArray(m.ids) && m.ids.length) {
      const aq = ws.deserializeAttachment() || {};
      if (!aq.authed || aq.did !== m.did) return; // doar proprietarul autentificat (C1)
      // confirmare de livrare durabilă: scoate din coadă DOAR mesajele decriptate+salvate
      // de client. Restul rămân pt re-livrare. (idempotent: id necunoscut = ignorat)
      const q = (await this.storage.get("queue:" + m.did)) || [];
      const left = removeAcked(q, m.ids); // scoate doar id-urile confirmate; restul rămân
      if (left.length) await this.storage.put("queue:" + m.did, left);
      else await this.storage.delete("queue:" + m.did);
      return;
    }

    if (m.t === "getbundle" && m.did) {
      const r = await this.bundleRouted(m.did); // cross-shard: bundle-ul e pe shardul lui m.did
      ws.send(JSON.stringify({ t: "bundle", did: m.did, bundle: r.bundle, opk: r.opk })); // #4 opk POPat
      return;
    }

    if (m.t === "push" && m.did && m.token) {
      const ap = ws.deserializeAttachment() || {};
      if (!ap.authed || ap.did !== m.did) return; // C1: nu lăsa pe altcineva să-ți seteze push token
      await this.storage.put("push:" + m.did, m.token); // token FCM pt notificări cu app închis
      return;
    }

    if (m.t === "dereg" && m.did) {
      const ad = ws.deserializeAttachment() || {};
      if (!ad.authed || ad.did !== m.did) return; // C1: doar proprietarul își poate șterge identitatea
      // B2 — wipe identity: șterge tot ce ține releul de acest DID (bundle + coadă + push)
      await this.storage.delete("bundle:" + m.did);
      await this.storage.delete("queue:" + m.did);
      await this.storage.delete("push:" + m.did);
      return;
    }

    if (m.t === "send" && m.to && m.env) {
      const live = await this.deliverRouted(m.to, m.env); // cross-shard: livreaza pe shardul lui m.to
      return;
    }

    if (m.t === "ping") ws.send(JSON.stringify({ t: "pong" }));
  }

  // --- Push FCM (HTTP v1): JWT service account → OAuth → messages:send ---
  async getAccessToken() {
    const env = this.env;
    if (!env || !env.FCM_CLIENT_EMAIL || !env.FCM_PRIVATE_KEY) return null;
    const now = Math.floor(Date.now() / 1000);
    if (this.fcmAt && this.fcmAtExp > now + 60) return this.fcmAt;
    const jwt = await buildServiceJwt(env.FCM_CLIENT_EMAIL, env.FCM_PRIVATE_KEY, now); // pur, testat
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + jwt,
    });
    const j = await res.json();
    if (!j.access_token) return null;
    this.fcmAt = j.access_token;
    this.fcmAtExp = now + (j.expires_in || 3600);
    return this.fcmAt;
  }

  async pushNotify(toDid) {
    // T4 — pushNotify se cheamă pt FIECARE plic offline (o poză = ~125 bucăți + resend-uri).
    // NOTIFY-ONCE-PÂNĂ-ONLINE: notificăm o SINGURĂ dată, apoi tăcem până revine destinatarul.
    // Flag PERSISTENT `pushed:<DID>` (nu Map in-memory — DO-ul hibernează la WebSocket Hibernation
    // și ștergea harta → sunetul se re-alerta la fiecare plic din furtună). Se șterge la `reg`.
    if (!shouldPush(await this.storage.get("pushed:" + toDid))) return;
    try {
      const token = await this.storage.get("push:" + toDid);
      if (!token) return;
      await this.storage.put("pushed:" + toDid, 1); // marchează ÎNAINTE de fetch (anti-duplicat concurent)
      const at = await this.getAccessToken();
      if (!at) return;
      await fetch(`https://fcm.googleapis.com/v1/projects/${this.env.FCM_PROJECT_ID}/messages:send`, {
        method: "POST",
        headers: { authorization: "Bearer " + at, "content-type": "application/json" },
        body: JSON.stringify({ message: buildPushMessage(token, toDid) }),
      });
    } catch {
      /* push eșuat — mesajul rămâne în coadă, se livrează la reconectare */
    }
  }

  async webSocketClose(ws) {
    try { ws.close(); } catch {}
  }

  async webSocketError() {}
}

// Ruteaza fiecare request pe shardul potrivit (vezi nota SHARDING de sus).
function homeStub(env, did) {
  return env.RELAY.get(env.RELAY.idFromName(shardName(did)));
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    // Health: un shard fix (online = doar al shardului ăsta, suficient pt check).
    if (url.pathname === "/health") return homeStub(env, "_health").fetch(req);

    // TURN: generează credențiale EFEMERE Cloudflare Realtime pt apeluri pe date mobile
    // (NAT simetric). Secretul (API token) stă în Worker, NU în app → app-ul cere /turn
    // și primește doar credențiale scurte. Fără secrete configurate → STUN-only (fallback).
    if (url.pathname === "/turn") {
      const headers = { "content-type": "application/json", "access-control-allow-origin": "*" };
      if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) return new Response(JSON.stringify({ iceServers: null }), { headers });
      try {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate`, {
          method: "POST",
          headers: { authorization: `Bearer ${env.TURN_API_TOKEN}`, "content-type": "application/json" },
          body: JSON.stringify({ ttl: 86400 }),
        });
        const j = await r.json();
        return new Response(JSON.stringify({ iceServers: j.iceServers ?? null }), { headers });
      } catch { return new Response(JSON.stringify({ iceServers: null }), { headers }); }
    }

    // Trimitere sealed prin HTTP: ruteaza pe shardul DESTINATARULUI (body.to).
    if (url.pathname === "/send" && req.method === "POST") {
      const body = await req.clone().json().catch(() => null);
      if (!body || !body.to) return new Response("missing", { status: 400 });
      return homeStub(env, body.to).fetch(req);
    }

    // Upgrade WebSocket: ruteaza pe shardul de casa al userului (did din query).
    if ((req.headers.get("Upgrade") || "").toLowerCase() === "websocket") {
      const did = url.searchParams.get("did") || "_legacy"; // clientii vechi (fara ?did) cad pe un shard comun
      return homeStub(env, did).fetch(req);
    }

    return new Response("blink-relay\n");
  },
};
