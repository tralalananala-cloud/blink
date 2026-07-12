/**
 * Client transport Reticulum (A1 — transport ORB) prin gateway-ul Blink↔Reticulum.
 * App-ul trimite/primește plicuri E2E (libsignal) ca blob-uri OPACE — gateway-ul/nodurile
 * nu văd conținutul. Reticulum + I2P → descentralizat + IP ascuns (metadate minime).
 *
 * Activat doar dacă RETICULUM_GATEWAY e setat în config. Altfel, no-op (Blink merge pe releu).
 * Adresa Reticulum a unui peer se învață din payload-ul mesajelor (câmp `ra`) — fără QR nou.
 */
import { RETICULUM_GATEWAY } from "../config";
import { engine } from "../crypto";
import { useApp } from "../state/store";

class ReticulumTransport {
  myAddr: string | null = null;
  // token-ul de inbox (persistat server-side per DID, primit la fiecare register) —
  // fără el gateway-ul refuză /recv, ca să nu poată goli nimeni inbox-ul altcuiva.
  private token: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private onBlob: ((blobB64: string) => void) | null = null;

  /** Adresa gateway-ului: setarea userului are prioritate; altfel valoarea din build (de obicei gol). */
  private gw(): string {
    return (useApp.getState().settings.reticulumGateway || RETICULUM_GATEWAY || "").trim().replace(/\/$/, "");
  }
  /** Activ doar dacă userul a pornit toggle-ul ȘI există o adresă de gateway. */
  on(): boolean {
    return !!useApp.getState().settings.reticulumEnabled && !!this.gw();
  }

  private async post(path: string, body: any): Promise<any> {
    const r = await fetch(this.gw() + path, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return r.json();
  }

  /** Înregistrează DID-ul la gateway → adresa Reticulum proprie. Challenge-response (schema
   *  releului): gateway-ul emite un nonce, îl semnăm cu cheia de auth a DID-ului, gateway-ul
   *  verifică semnătura + binding-ul DID → nimeni nu poate revendica DID-ul altcuiva. */
  async register(did: string): Promise<string | null> {
    if (!this.on()) return null;
    try {
      const j1 = await this.post("/register", { did });
      let j = j1;
      if (j1.nonce) {
        if (!engine.signChallenge) return null; // motor fără auth (web stub) → fără Reticulum
        const auth = engine.signChallenge(j1.nonce);
        const ls = JSON.parse(engine.getBundle().ls ?? "{}");
        j = await this.post("/register", { did, idKey: ls.idKey, authPub: auth.pub, sig: auth.sig });
      }
      this.myAddr = j.addr ?? null;
      this.token = j.token ?? null;
      return this.myAddr;
    } catch { return null; }
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

  /** Uită adresa/token-ul + oprește polling-ul (la schimbarea gateway-ului sau dezactivare). */
  reset() { this.stopPolling(); this.myAddr = null; this.token = null; }

  private async poll() {
    if (!this.on() || !this.myAddr || !this.token) return;
    try {
      const r = await fetch(`${this.gw()}/recv?addr=${encodeURIComponent(this.myAddr)}&token=${encodeURIComponent(this.token)}`);
      const j = await r.json();
      for (const b of (j.msgs || [])) this.onBlob?.(b);
    } catch { /* offline / gateway jos — reîncearcă la următorul tick */ }
  }
}

export const reticulum = new ReticulumTransport();
