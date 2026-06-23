/**
 * Blink relay — RELEU OARB.
 *
 * Rutează plicuri criptate E2E între dispozitive și le ține pentru destinatari
 * offline (store-and-forward). NU vede niciodată plaintext — doar:
 *   - DID-uri (chei publice de identitate),
 *   - prekey bundle-uri (chei publice, pentru X3DH),
 *   - plicuri (ciphertext sigilat de capete).
 *
 * Protocol JSON peste WebSocket:
 *   → { t:"reg", did, bundle }       înregistrează + publică bundle-ul
 *   ← { t:"ready", queued:N }        + livrează mesajele în coadă
 *   → { t:"getbundle", did }         cere bundle-ul cuiva
 *   ← { t:"bundle", did, bundle }
 *   → { t:"send", to, env }          trimite un plic către un DID
 *   ← { t:"msg", env }               plic primit
 *   → { t:"ping" } ← { t:"pong" }
 */
import { WebSocketServer } from "ws";
import http from "http";

const PORT = process.env.PORT || 8787;

const bundles = new Map(); // did -> bundle (public prekeys)
const sockets = new Map(); // did -> ws
const queues = new Map(); // did -> [env]  (store-and-forward)
const TTL = 30 * 24 * 3600 * 1000; // 30 zile

function log(...a) {
  console.log(new Date().toISOString(), ...a);
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, online: sockets.size, bundles: bundles.size }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("blink-relay\n");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.did = null;
  ws.on("message", (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }

    if (m.t === "reg" && m.did) {
      ws.did = m.did;
      sockets.set(m.did, ws);
      if (m.bundle) bundles.set(m.did, m.bundle);
      // livrează coada
      const q = queues.get(m.did) || [];
      const now = Date.now();
      const fresh = q.filter((x) => now - x.ts < TTL);
      queues.delete(m.did);
      ws.send(JSON.stringify({ t: "ready", queued: fresh.length }));
      for (const x of fresh) ws.send(JSON.stringify({ t: "msg", env: x.env }));
      log("reg", m.did.slice(0, 24), "online:", sockets.size, "delivered:", fresh.length);
      return;
    }

    if (m.t === "getbundle" && m.did) {
      ws.send(JSON.stringify({ t: "bundle", did: m.did, bundle: bundles.get(m.did) || null }));
      return;
    }

    if (m.t === "send" && m.to && m.env) {
      const dest = sockets.get(m.to);
      if (dest && dest.readyState === 1) {
        dest.send(JSON.stringify({ t: "msg", env: m.env }));
      } else {
        // store-and-forward
        const q = queues.get(m.to) || [];
        q.push({ env: m.env, ts: Date.now() });
        queues.set(m.to, q);
      }
      return;
    }

    if (m.t === "ping") ws.send(JSON.stringify({ t: "pong" }));
  });

  ws.on("close", () => {
    if (ws.did && sockets.get(ws.did) === ws) sockets.delete(ws.did);
    log("disconnect", ws.did?.slice(0, 24), "online:", sockets.size);
  });
  ws.on("error", () => {});
});

server.listen(PORT, "0.0.0.0", () => log(`blink-relay on :${PORT}`));
