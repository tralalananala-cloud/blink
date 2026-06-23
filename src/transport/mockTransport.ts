/**
 * Transport MOCK — simuleaza retea, NU vorbeste pe internet.
 * Loopback in proces: ce trimiti, primesti inapoi dupa o latenta simulata.
 * Faza 2: inlocuit cu un Transport libp2p real.
 */
import { CipherEnvelope } from "../crypto/types";
import { PeerStatus, Transport, TransportStatus } from "./types";

export class MockTransport implements Transport {
  readonly name = "mock-loopback";
  private mode: TransportStatus["mode"] = "p2p";
  private subs = new Set<(e: CipherEnvelope) => void>();

  status(): TransportStatus {
    return {
      mode: this.mode,
      knownPeers: this.mode === "offline" ? 0 : 7,
      online: this.mode !== "offline" && this.mode !== "mesh",
    };
  }

  peerStatus(peerDid: string): PeerStatus {
    if (this.mode === "offline") return "offline";
    if (this.mode === "mesh") return "mesh";
    // demo: peers cu DID "par" sunt directi, restul prin releu
    return peerDid.length % 2 === 0 ? "direct" : "relay";
  }

  async send(envelope: CipherEnvelope): Promise<{ queuedOnRelay: boolean }> {
    const offline = this.peerStatus(envelope.toDid) === "offline";
    // simuleaza latenta + livrare (loopback pentru demo)
    setTimeout(() => {
      this.subs.forEach((cb) => cb(envelope));
    }, 350);
    return { queuedOnRelay: offline };
  }

  onEnvelope(cb: (e: CipherEnvelope) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  setMode(mode: TransportStatus["mode"]): void {
    this.mode = mode;
  }
}

export const transport: Transport = new MockTransport();
