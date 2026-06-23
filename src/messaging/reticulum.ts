/**
 * Client transport Reticulum (A1 — transport ORB) prin gateway-ul Blink↔Reticulum.
 * App-ul trimite/primește plicuri E2E (libsignal) ca blob-uri OPACE — gateway-ul/nodurile
 * nu văd conținutul. Reticulum + I2P → descentralizat + IP ascuns (metadate minime).
 *
 * Activat doar dacă RETICULUM_GATEWAY e setat în config. Altfel, no-op (Blink merge pe releu).
 * Adresa Reticulum a unui peer se învață din payload-ul mesajelor (câmp `ra`) — fără QR nou.
 */
import { RETICULUM_GATEWAY } from "../config";

class ReticulumTransport {
  myAddr: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private onBlob: ((blobB64: string) => void) | null = null;

  on(): boolean { return !!RETICULUM_GATEWAY; }

  private async post(path: string, body: any): Promise<any> {
    const r = await fetch(RETICULUM_GATEWAY + path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return r.json();
  }

  /** Înregistrează DID-ul la gateway → primește adresa Reticulum proprie. */
  async register(did: string): Promise<string | null> {
    if (!this.on()) return null;
    try { const j = await this.post("/register", { did }); this.myAddr = j.addr ?? null; return this.myAddr; }
    catch { return null; }
  }

  /** Trimite un blob opac (plic E2E) către adresa Reticulum a unui peer. */
  async send(toAddr: string, blobB64: string): Promise<boolean> {
    if (!this.on()) return false;
    try { const j = await this.post("/send", { to: toAddr, blob: blobB64 }); return !!j.ok; }
    catch { return false; }
  }

  /** Pornește polling-ul inbox-ului propriu; fiecare blob primit → callback. */
  startPolling(onBlob: (blobB64: string) => void) {
    this.onBlob = onBlob;
    this.stopPolling();
    this.pollTimer = setInterval(() => void this.poll(), 4000);
  }
  stopPolling() { if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; } }

  private async poll() {
    if (!this.on() || !this.myAddr) return;
    try {
      const r = await fetch(`${RETICULUM_GATEWAY}/recv?addr=${encodeURIComponent(this.myAddr)}`);
      const j = await r.json();
      for (const b of (j.msgs || [])) this.onBlob?.(b);
    } catch { /* offline / gateway jos — reîncearcă la următorul tick */ }
  }
}

export const reticulum = new ReticulumTransport();
