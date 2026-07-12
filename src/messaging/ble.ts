/**
 * Transport BLE mesh (telefon↔telefon prin Bluetooth, fără internet) — v1: livrare DIRECTĂ
 * în proximitate, fără multi-hop (vezi BLE_MESH_PLAN.md). Același plic E2E (libsignal) ca pe
 * releu/Reticulum — Bluetooth-ul e doar alt tub, conținutul rămâne opac.
 *
 * Descoperire: fiecare device anunță did8 = primii 8 octeți din SHA-256(DID), hex; peer-ii
 * se recunosc după did8. ⚠️ did8 e stabil → observabil de un adversar radio local; rotația
 * identificatorului = backlog post-MVP (documentat în plan).
 *
 * Activ doar dacă toggle-ul din Settings e pornit ȘI modulul nativ există în build.
 */
import { hash, utf8 } from "../crypto/signal/primitives";
import { useApp } from "../state/store";
import { BleNative, ensureBlePermissions, loadBleNative } from "./bleNative";

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** Identificatorul BLE al unui DID (8 octeți hex din SHA-256). */
export const did8 = (did: string): string => toHex(hash(utf8(did)).slice(0, 8));

/**
 * Textele notificării permanente a serviciului de foreground (BLE-4). `require` leneș, nu import:
 * i18n-ul trage expo-localization, care nu există în jest — iar transportul trebuie să rămână
 * testabil fără mock-uri de platformă. Fără dicționar → engleză, nu crăpăm.
 */
function notifStrings(): { title: string; body: string } {
  try {
    const t = require("../i18n").dictFor().settings;
    return { title: t.bleMeshNotifTitle, body: t.bleMeshNotifBody };
  } catch {
    return { title: "Blink — Bluetooth mesh on", body: "Staying reachable to nearby phones, with no internet." };
  }
}

class BleMeshTransport {
  private native: BleNative | null | undefined; // undefined = încă neîncărcat (lazy, o dată)
  private nearby = new Set<string>(); // did8-urile peer-ilor văzuți acum în raza Bluetooth
  private subs: { remove(): void }[] = [];
  private started = false;
  /** Chemat când apare un peer nou în rază (relay golește outbox-ul spre el — livrare fără releu). */
  onPeerNear?: () => void;

  private nat(): BleNative | null {
    if (this.native === undefined) this.native = loadBleNative();
    return this.native;
  }

  /** Activ doar dacă userul a pornit toggle-ul ȘI modulul nativ e disponibil. */
  on(): boolean {
    return !!useApp.getState().settings.bleMeshEnabled && !!this.nat();
  }

  /** Peer-ul e în raza Bluetooth acum? (decide dacă transmit() încearcă BLE) */
  canReach(peerDid: string): boolean {
    return this.nearby.has(did8(peerDid));
  }

  /** E vreun peer în rază? (ține sweep-ul outbox-ului viu și cu releul jos) */
  anyNearby(): boolean {
    return this.nearby.size > 0;
  }

  /** Pornește radio-ul (advertise+scan+GATT); blob-urile primite → callback. Idempotent. */
  async start(myDid: string, onBlob: (blobB64: string) => void): Promise<boolean> {
    const n = this.nat();
    if (!n || this.started) return this.started;
    if (!(await ensureBlePermissions())) return false; // refuz permisiuni → rămâne pe releu
    try {
      this.subs.push(n.addListener("onBlob", (e) => { if (e.blobB64) onBlob(e.blobB64); }));
      this.subs.push(n.addListener("onPeerSeen", (e) => {
        if (!e.did8) return;
        console.log("[BLE] peer seen în JS:", e.did8);
        this.nearby.add(e.did8);
        try { this.onPeerNear?.(); } catch {}
      }));
      this.subs.push(n.addListener("onPeerLost", (e) => { if (e.did8) this.nearby.delete(e.did8); }));
      const { title, body } = notifStrings();
      await n.start(did8(myDid), title, body);
      this.started = true;
      console.log("[BLE] transport pornit, did8 propriu:", did8(myDid));
    } catch {
      this.reset(); // radio indisponibil (BT oprit / permisiuni lipsă) → rămâne oprit, fallback releu
    }
    return this.started;
  }

  /** Trimite un blob opac unui peer din apropiere. false = cade pe următorul transport din lanț. */
  async send(peerDid: string, blobB64: string): Promise<boolean> {
    const n = this.nat();
    if (!n || !this.started) return false;
    try {
      const ok = await n.send(did8(peerDid), blobB64);
      console.log("[BLE] send către", did8(peerDid), "→", ok);
      return ok;
    } catch (e) {
      console.log("[BLE] send a aruncat:", String(e));
      return false;
    }
  }

  /** Oprește radio-ul + uită peer-ii (toggle off, wipe, repornire curată). */
  reset() {
    for (const s of this.subs) { try { s.remove(); } catch {} }
    this.subs = [];
    this.nearby.clear();
    if (this.started) { try { void this.nat()?.stop(); } catch {} }
    this.started = false;
  }
}

export const bleMesh = new BleMeshTransport();
