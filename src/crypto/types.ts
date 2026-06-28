/**
 * Contractul motorului criptografic.
 *
 * Acesta este "slotul" peste care, in Faza 2, se monteaza implementarea REALA:
 * libsignal (X3DH + Double Ratchet) printr-un native module.
 * Restul aplicatiei vorbeste DOAR cu aceasta interfata — niciun ecran nu
 * atinge primitive criptografice direct. Asa putem schimba mock-ul cu
 * implementarea reala fara sa atingem UI-ul.
 *
 * Primitive tinta (Faza 2): X25519, Ed25519, ChaCha20-Poly1305, AES-256-GCM.
 * Random: doar CSPRNG-ul OS-ului.
 */

/** Identitate locala = pereche de chei generata pe dispozitiv (DID:key). */
export interface Identity {
  /** did:key:... derivat din cheia publica Ed25519. */
  did: string;
  /** Cheia publica de identitate (Ed25519), hex. */
  publicKey: string;
  /** Fingerprint citibil de om, grupat (afisat in onboarding & Vault). */
  fingerprint: string;
  /** Cand a fost generata (epoch ms). */
  createdAt: number;
}

/** O sesiune Double Ratchet stabilita cu un anumit peer. */
export interface SessionInfo {
  peerDid: string;
  /** Numarul de pasi de ratchet efectuati (indicator UI "sesiune securizata"). */
  ratchetStep: number;
  /** Safety number / cod de verificare comparabil la verificarea QR. */
  safetyNumber: string;
  established: boolean;
}

/** Bundle de prekey-uri (chei PUBLICE) publicat pe releu pentru X3DH async. */
export interface SerializedBundle {
  ikPub: string;
  edPub: string;
  spkPub: string;
  spkSig: string;
  opkPub?: string;
  /** libsignal: bundle complet (JSON base64) — câmp opac purtat prin releu. */
  ls?: string;
  /** #4: one-time prekey POPat de releu pt acest fetch (unic per contact). */
  opk?: { id: number; pub: string };
}

/** Rezultatul criptarii: payload opac transportat de retea. */
export interface CipherEnvelope {
  /** DID expeditor (ca destinatarul sa gaseasca/stabileasca sesiunea). */
  fromDid: string;
  /** DID destinatar (releele oarbe vad doar atat — nu continutul). */
  toDid: string;
  /** Continut criptat (base64). Nimeni in afara de capete nu il citeste. */
  ciphertext: string;
  /** Antet de ratchet (index, chei efemere publice), base64. */
  header: string;
  /** Date X3DH pentru primul mesaj (prekey message): cheile publice ale initiatorului. */
  prekey?: { ik: string; ek: string };
  /** Proof-of-work atasat la trimitere (anti-spam, vezi Transport). */
  pow?: string;
  ts: number;
}

export interface DecryptResult {
  plaintext: string;
  /** True daca decriptarea a avansat ratchet-ul (forward secrecy demonstrabil). */
  ratchetAdvanced: boolean;
}

/**
 * Plic sealed sender (#2 metadate): NU conține fromDid în clar — identitatea
 * expeditorului e criptată în interior, către cheia destinatarului. Releul vede
 * doar `toDid` (necesar pt rutare) + un blob opac.
 */
export interface SealedEnvelope {
  toDid: string;
  sealed: string; // blob sealed sender (base64)
  ts: number;
}

export interface SealedDecryptResult extends DecryptResult {
  /** Expeditorul, aflat DOAR după decriptare (din certificatul din interior). */
  fromDid: string;
}

export interface CryptoEngine {
  /** Marcheaza daca aceasta implementare ofera securitate reala (protocol real). */
  readonly isSecure: boolean;
  /** True doar daca implementarea protocolului e auditata extern (libsignal oficial). */
  readonly isAudited?: boolean;
  readonly name: string;

  /** Genereaza o identitate noua si o pastreaza in SecureStorage. */
  generateIdentity(): Promise<Identity>;

  /** Incarca identitatea existenta din SecureStorage (sau null daca nu exista). */
  loadIdentity(): Promise<Identity | null>;

  /** Restaureaza identitatea dintr-o fraza de recuperare (12 cuvinte). */
  restoreIdentity(mnemonic: string): Promise<Identity>;

  /** Fraza de recuperare de 12 cuvinte pentru identitatea curenta. */
  exportRecoveryPhrase(): Promise<string[]>;

  /** X3DH: stabileste o sesiune cu un peer din pre-key bundle-ul lui. */
  establishSession(peerDid: string, peerBundle?: unknown): Promise<SessionInfo>;

  getSession(peerDid: string): Promise<SessionInfo | null>;

  /** Bundle-ul propriu de prekey-uri (chei publice) de publicat pe releu. */
  getBundle(): SerializedBundle;

  /** Inițiază o sesiune reală cu un peer pornind de la bundle-ul lui (X3DH). */
  startOutbound(peerDid: string, bundle: SerializedBundle): Promise<SessionInfo>;

  /** Există deja o sesiune (ratchet) cu acest peer? */
  hasSession(peerDid: string): boolean;

  /** Cripteaza un mesaj text pentru un peer (avanseaza ratchet-ul). */
  encrypt(peerDid: string, plaintext: string): Promise<CipherEnvelope>;

  /** Decripteaza un plic primit. */
  decrypt(envelope: CipherEnvelope): Promise<DecryptResult>;

  /** Safety number pentru verificare fata-in-fata (QR). */
  computeSafetyNumber(peerDid: string): Promise<string>;

  /** Sealed sender (#2): criptează ascunzând expeditorul față de releu. Opțional —
   *  doar motoarele care suportă (libsignal). */
  encryptSealed?(peerDid: string, plaintext: string): Promise<SealedEnvelope>;
  /** Decriptează un plic sealed: află expeditorul DOAR după decriptare. */
  decryptSealed?(env: SealedEnvelope): Promise<SealedDecryptResult>;

  /** Persistă sesiunile (ratchet) în baza criptată — Faza 1. */
  persistSessions?(): void;

  /** Reîncarcă sesiunile la pornire. */
  loadSessions?(): Promise<void>;

  /** B2 — la wipe: scoate seed-ul, identitatea și sesiunile din memorie. */
  clearIdentity?(): void;

  /** Re-pairing: scoate sesiunea cu un peer → următorul mesaj re-stabilește X3DH. */
  resetSession?(peerDid: string): void;

  /** Auth releu (C1): semnează un nonce de la releu cu cheia de identitate derivată din seed.
   *  Întoarce cheia publică + semnătura (base64). Releul verifică proprietatea DID-ului. */
  signChallenge?(nonce: string): { pub: string; sig: string };

  /** #4: batch de one-time prekey-uri (publice) de urcat la reg; releul le POPează per getbundle. */
  getOpkBatch?(): { id: number; pub: string }[];
}
