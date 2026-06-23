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

const TTL = 30 * 24 * 3600 * 1000; // 30 zile
const shardName = (did) => "shard:" + did;
// #5 anti-abuz: plafon coadă (stochare) + rate-limit/dest (anti-flood). Generos, ca să
// nu afecteze conversațiile normale; oprește doar inundațiile de spam.
const MAX_QUEUE = 1000;
const RL_MAX = 240;        // mesaje
const RL_WINDOW = 60_000;  // pe minut, per destinatar

export class Relay {
  constructor(state, env) {
    this.state = state;
    this.storage = state.storage;
    this.env = env;
    this.fcmAt = null;
    this.fcmAtExp = 0;
    this.rl = new Map(); // #5 rate-limit per destinatar (in-memory pe shard)
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
      while (q.length >= MAX_QUEUE) q.shift(); // #5 nu lăsa coada să crească nelimitat (spam la offline)
      q.push({ env, ts: Date.now() });
      await this.storage.put("queue:" + to, q);
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

  // Bundle-ul lui `did` traieste pe shardul lui: citeste local sau cere cross-shard.
  async bundleRouted(did) {
    if (this.ownsLocally(did)) return (await this.storage.get("bundle:" + did)) || null;
    const stub = this.env.RELAY.get(this.env.RELAY.idFromName(shardName(did)));
    try {
      const res = await stub.fetch("https://relay/bundle?did=" + encodeURIComponent(did));
      const j = await res.json();
      return j.bundle || null;
    } catch { return null; }
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
      return new Response(JSON.stringify({ bundle: b }), { headers: { "content-type": "application/json" } });
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

    if (m.t === "reg" && m.did) {
      ws.serializeAttachment({ did: m.did }); // supravietuieste hibernarii
      this.closeStale(m.did, ws); // reconectare: scapa de socketul vechi (anti false LIVRAT-LIVE)
      if (m.bundle) await this.storage.put("bundle:" + m.did, m.bundle);
      const q = (await this.storage.get("queue:" + m.did)) || [];
      const now = Date.now();
      const fresh = q.filter((x) => now - x.ts < TTL);
      await this.storage.delete("queue:" + m.did);
      ws.send(JSON.stringify({ t: "ready", queued: fresh.length }));
      for (const x of fresh) ws.send(JSON.stringify({ t: "msg", env: x.env }));
      return;
    }

    if (m.t === "getbundle" && m.did) {
      const b = await this.bundleRouted(m.did); // cross-shard: bundle-ul e pe shardul lui m.did
      ws.send(JSON.stringify({ t: "bundle", did: m.did, bundle: b }));
      return;
    }

    if (m.t === "push" && m.did && m.token) {
      await this.storage.put("push:" + m.did, m.token); // token FCM pt notificări cu app închis
      return;
    }

    if (m.t === "dereg" && m.did) {
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
    const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claim = b64urlStr(JSON.stringify({
      iss: env.FCM_CLIENT_EMAIL,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now, exp: now + 3600,
    }));
    const unsigned = header + "." + claim;
    const key = await crypto.subtle.importKey(
      "pkcs8", pemToArrayBuffer(env.FCM_PRIVATE_KEY),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
    );
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
    const jwt = unsigned + "." + b64url(sig);
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
    try {
      const token = await this.storage.get("push:" + toDid);
      if (!token) return;
      const at = await this.getAccessToken();
      if (!at) return;
      await fetch(`https://fcm.googleapis.com/v1/projects/${this.env.FCM_PROJECT_ID}/messages:send`, {
        method: "POST",
        headers: { authorization: "Bearer " + at, "content-type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: "Blink", body: "Mesaj nou criptat" }, // generic — releul nu vede conținutul
            android: { priority: "high" },
          },
        }),
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

// --- utilitare push (Web Crypto) ---
function pemToArrayBuffer(pem) {
  const clean = pem
    .replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(clean);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}
function b64url(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlStr(s) {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
