/**
 * Contractul stratului de transport.
 *
 * Slot pentru Faza 2: libp2p (WebRTC datachannels + QUIC), descoperire DHT,
 * relee oarbe pentru store-and-forward (offline messaging), optional Tor,
 * fallback Bluetooth mesh. Toate releele sunt OARBE — vad doar plicuri criptate.
 *
 * Anti-abuse (din modelul de amenintare): proof-of-work la trimitere +
 * rate limiting + validare stricta a fiecarui pachet inainte de procesare.
 */
import { CipherEnvelope } from "../crypto/types";

export type PeerStatus = "direct" | "relay" | "mesh" | "offline";

export interface TransportStatus {
  /** Cum suntem conectati la retea in ansamblu. */
  mode: "p2p" | "relay" | "tor" | "mesh" | "offline";
  /** Numar de peers cunoscuti in DHT (demo). */
  knownPeers: number;
  /** Conexiune la internet disponibila? */
  online: boolean;
}

export interface Transport {
  readonly name: string;

  status(): TransportStatus;

  /** Starea de raoute catre un anumit peer (direct vs prin releu vs mesh). */
  peerStatus(peerDid: string): PeerStatus;

  /**
   * Trimite un plic criptat. Daca peer-ul e offline, e depus pe relee oarbe
   * (store-and-forward, TTL). `pow` ataseaza proof-of-work anti-spam.
   */
  send(envelope: CipherEnvelope): Promise<{ queuedOnRelay: boolean }>;

  /** Aboneaza-te la plicurile primite (din releu/direct/mesh). */
  onEnvelope(cb: (e: CipherEnvelope) => void): () => void;

  /** Schimba modul de transport (Setari). */
  setMode(mode: TransportStatus["mode"]): void;
}
