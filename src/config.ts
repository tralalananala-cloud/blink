/**
 * Config releu — PRODUCȚIE: releu oarb pe Cloudflare Workers + Durable Objects.
 * wss:// cu TLS, mereu disponibil, fără server propriu. Persistent (cozile + bundle-urile
 * în DO storage). Vezi ~/cipher-relay/cf-worker/.
 *
 * Dev local (optional): porneste `node ~/cipher-relay/server.js` si pune ws://<IP-LAN>:8787.
 */
export const RELAY_URL = "wss://blink-relay.tralalananala.workers.dev";

/** Endpoint HTTP pentru trimitere ANONIMĂ (sealed sender #2): derivat din RELAY_URL
 *  (wss:// → https://). Releul nu asociază trimiterea cu identitatea conexiunii. */
export const RELAY_HTTP = RELAY_URL.replace(/^wss:/, "https:").replace(/^ws:/, "http:");

/**
 * Gateway Reticulum (A1 transport orb, opțional). Gol = dezactivat → Blink merge pe releu.
 * Setat (ex. "http://192.168.0.x:8090" în LAN sau un nod găzduit) → mesajele E2E pot ruta
 * descentralizat prin Reticulum/I2P (IP ascuns), gateway-ul cărând doar blob-uri opace.
 * Experimental — vezi ~/reticulum-lab.
 */
export const RETICULUM_GATEWAY = "";

/**
 * Servere ICE pentru apeluri WebRTC (Faza 5). STUN public gratuit (Google) acoperă
 * majoritatea NAT-urilor; pt NAT simetric (mobil↔mobil pe rețele diferite) e nevoie
 * de un server TURN — completează URL/credențiale aici când îl găzduiești (coturn).
 * Semnalizarea (offer/answer/ICE) trece criptată E2E prin releu (vezi relay.ts).
 */
export const ICE_SERVERS: { urls: string | string[]; username?: string; credential?: string }[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

/**
 * Cere credențiale TURN EFEMERE de la releu (Cloudflare Realtime) — pt apeluri pe date
 * mobile / NAT simetric. Releul ține secretul; app-ul primește doar credențiale scurte.
 * Eșec / TURN neconfigurat → STUN-only (fallback). Apelat înainte de fiecare apel.
 */
export async function fetchIceServers(): Promise<{ urls: string | string[]; username?: string; credential?: string }[]> {
  try {
    const r = await fetch(RELAY_HTTP + "/turn");
    const j = await r.json();
    if (j && j.iceServers) return [...ICE_SERVERS, j.iceServers]; // STUN + TURN Cloudflare
  } catch {}
  return ICE_SERVERS;
}
