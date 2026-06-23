/**
 * SignalEngine — criptografie REALĂ cu DOUĂ PĂRȚI (Faza 2).
 *
 * Fiecare dispozitiv are identitatea lui (seed persistent) și publică un
 * prekey bundle (chei publice) pe releu. Mesageria reală:
 *   - inițiatorul ia bundle-ul destinatarului → X3DH → Double Ratchet;
 *   - primul mesaj e „prekey message" (poartă cheile publice ale inițiatorului);
 *   - destinatarul completează X3DH la primire.
 *
 * isSecure=true, isAudited=false (protocol implementat aici, cu teste;
 * producție = libsignal oficial nativ).
 */
import {
  CipherEnvelope,
  CryptoEngine,
  DecryptResult,
  Identity,
  SerializedBundle,
  SessionInfo,
} from "./types";
import { KEYS, secureStorage } from "../storage/secure";
import { dbGetItem, dbSetItem, DB_KEYS } from "../storage/db";
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from "../identity/did";
import {
  Bytes,
  fromB64,
  fromUtf8,
  hash,
  hkdfBytes,
  KeyPair,
  sign,
  toB64,
  utf8,
} from "./signal/primitives";
import { x25519, ed25519 } from "@noble/curves/ed25519";
import { IdentityKeys, PreKeyBundle, PreKeySecrets, x3dhInitiator, x3dhResponder } from "./signal/x3dh";
import {
  headerFromB64,
  headerToB64,
  initAlice,
  initBob,
  ratchetDecrypt,
  ratchetEncrypt,
  RatchetState,
} from "./signal/doubleRatchet";

interface Session {
  ratchet: RatchetState;
  safety: string;
  /** Pt inițiator: cheile X3DH de atașat până primim un răspuns. */
  pendingInit?: { ik: Bytes; ek: Bytes };
}

function deriveDH(seed: Bytes, info: string): KeyPair {
  const priv = hkdfBytes(seed, new Uint8Array(32), "Cipher_kd_" + info, 32);
  return { priv, pub: x25519.getPublicKey(priv) };
}
function deriveEd(seed: Bytes, info: string): KeyPair {
  const priv = hkdfBytes(seed, new Uint8Array(32), "Cipher_kd_" + info, 32);
  return { priv, pub: ed25519.getPublicKey(priv) };
}
function identityFromSeed(seed: Bytes): IdentityKeys {
  return { ik: deriveDH(seed, "ik"), ed: deriveEd(seed, "ed") };
}

function toHex(b: Bytes): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}
function didFromEd(edPub: Bytes): string {
  return "did:key:z6Mk" + toB64(edPub).replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
}
function fingerprint(ikPub: Bytes): string {
  return toHex(ikPub).slice(0, 32).toUpperCase().match(/.{1,4}/g)!.join(" ");
}
function safetyNumber(a: Bytes, b: Bytes): string {
  const [x, y] = toB64(a) < toB64(b) ? [a, b] : [b, a];
  let h = hash(new Uint8Array([...x, ...y]));
  for (let i = 0; i < 16; i++) h = hash(h);
  let digits = "";
  for (let i = 0; i < 60; i++) digits += (h[i % h.length] % 10).toString();
  return digits.match(/.{1,5}/g)!.join(" ");
}
/** AD canonic, identic pe ambele capete (din cele două DID-uri). */
function adFor(a: string, b: string): Bytes {
  return utf8([a, b].sort().join("|"));
}

// --- serializare sesiune (pt persistență criptată la repaus, Faza 1) ---
function serRatchet(r: RatchetState) {
  return {
    DHs: { priv: toB64(r.DHs.priv), pub: toB64(r.DHs.pub) },
    DHr: r.DHr ? toB64(r.DHr) : null,
    RK: toB64(r.RK),
    CKs: r.CKs ? toB64(r.CKs) : null,
    CKr: r.CKr ? toB64(r.CKr) : null,
    Ns: r.Ns, Nr: r.Nr, PN: r.PN,
    skipped: Array.from(r.skipped.entries()).map(([k, v]) => [k, toB64(v)]),
  };
}
function deserRatchet(o: any): RatchetState {
  return {
    DHs: { priv: fromB64(o.DHs.priv), pub: fromB64(o.DHs.pub) },
    DHr: o.DHr ? fromB64(o.DHr) : null,
    RK: fromB64(o.RK),
    CKs: o.CKs ? fromB64(o.CKs) : null,
    CKr: o.CKr ? fromB64(o.CKr) : null,
    Ns: o.Ns, Nr: o.Nr, PN: o.PN,
    skipped: new Map<string, Bytes>((o.skipped || []).map(([k, v]: [string, string]) => [k, fromB64(v)])),
  };
}
function serSession(s: Session) {
  return {
    ratchet: serRatchet(s.ratchet),
    safety: s.safety,
    pendingInit: s.pendingInit ? { ik: toB64(s.pendingInit.ik), ek: toB64(s.pendingInit.ek) } : undefined,
  };
}
function deserSession(o: any): Session {
  return {
    ratchet: deserRatchet(o.ratchet),
    safety: o.safety,
    pendingInit: o.pendingInit ? { ik: fromB64(o.pendingInit.ik), ek: fromB64(o.pendingInit.ek) } : undefined,
  };
}

function serializeBundle(b: PreKeyBundle): SerializedBundle {
  return {
    ikPub: toB64(b.ikPub), edPub: toB64(b.edPub), spkPub: toB64(b.spkPub),
    spkSig: toB64(b.spkSig), opkPub: b.opkPub ? toB64(b.opkPub) : undefined,
  };
}
function deserializeBundle(s: SerializedBundle): PreKeyBundle {
  return {
    ikPub: fromB64(s.ikPub), edPub: fromB64(s.edPub), spkPub: fromB64(s.spkPub),
    spkSig: fromB64(s.spkSig), opkPub: s.opkPub ? fromB64(s.opkPub) : undefined,
  };
}

// ─── Padding metadate (anti-analiză de trafic) ──────────────────────────────
// Înainte de criptare, plaintext-ul e umplut la o „găleată" de dimensiune fixă, ca
// lungimea ciphertext-ului să nu mai trădeze lungimea mesajului. 4 octeți antet de
// lungime + date + zerouri. Mesaje mici → 256B; mari → multiplu de 4096.
function bucketSize(n: number): number {
  for (const b of [256, 512, 1024, 2048, 4096]) if (n <= b) return b;
  return Math.ceil(n / 4096) * 4096;
}
function padBytes(bytes: Uint8Array): Uint8Array {
  const len = bytes.length;
  const out = new Uint8Array(bucketSize(len + 4));
  out[0] = (len >>> 24) & 255; out[1] = (len >>> 16) & 255; out[2] = (len >>> 8) & 255; out[3] = len & 255;
  out.set(bytes, 4);
  return out;
}
function unpadBytes(p: Uint8Array): Uint8Array {
  const len = ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
  return p.slice(4, 4 + len);
}

export class SignalEngine implements CryptoEngine {
  readonly isSecure = true;
  readonly isAudited = false;
  readonly name = "signal-noble (X3DH + Double Ratchet)";

  private seed: Bytes | null = null;
  private id: IdentityKeys | null = null;
  private identity: Identity | null = null;
  private sessions = new Map<string, Session>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Salvează sesiunile (ratchet) în baza criptată — debounced. */
  persistSessions(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      const obj: Record<string, any> = {};
      for (const [peer, s] of this.sessions) obj[peer] = serSession(s);
      await dbSetItem(DB_KEYS.sessions, JSON.stringify(obj));
    }, 400);
  }

  /** B2 — la wipe: scoate seed-ul, identitatea și TOATE sesiunile din memorie. */
  clearIdentity(): void {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    this.seed = null;
    this.id = null;
    this.identity = null;
    this.sessions.clear();
  }

  /** Reîncarcă sesiunile la pornire (altfel nu mai poți decripta după restart). */
  async loadSessions(): Promise<void> {
    const raw = await dbGetItem(DB_KEYS.sessions);
    if (!raw) return;
    try {
      const obj = JSON.parse(raw);
      for (const peer of Object.keys(obj)) this.sessions.set(peer, deserSession(obj[peer]));
    } catch {}
  }

  private buildIdentity(id: IdentityKeys): Identity {
    return { did: didFromEd(id.ed.pub), publicKey: toHex(id.ik.pub), fingerprint: fingerprint(id.ik.pub), createdAt: Date.now() };
  }
  private setFromSeed(seed: Bytes): Identity {
    this.seed = seed;
    this.id = identityFromSeed(seed);
    this.identity = this.buildIdentity(this.id);
    return this.identity;
  }
  private ensureId(): IdentityKeys {
    if (!this.id) throw new Error("SignalEngine: identitate neinițializată");
    return this.id;
  }
  private myDid(): string {
    return this.identity?.did ?? "self";
  }
  /** Prekey-urile proprii, derivate determinist din seed (persistă). */
  private mySecrets(): PreKeySecrets {
    return { spk: deriveDH(this.seed!, "self-spk"), opk: deriveDH(this.seed!, "self-opk") };
  }

  async generateIdentity(): Promise<Identity> {
    const mnemonic = generateMnemonic().join(" ");
    const seed = mnemonicToSeed(mnemonic); // BIP39 PBKDF2 (determinist)
    const identity = this.setFromSeed(seed);
    await secureStorage.setSecret(KEYS.identityPriv, toB64(seed));
    await secureStorage.setSecret(KEYS.mnemonic, mnemonic);
    return identity;
  }

  async restoreIdentity(mnemonic: string): Promise<Identity> {
    if (!validateMnemonic(mnemonic)) throw new Error("Frază de recuperare invalidă");
    const seed = mnemonicToSeed(mnemonic); // aceeași derivare ca la generare → aceeași identitate
    const identity = this.setFromSeed(seed);
    await secureStorage.setSecret(KEYS.identityPriv, toB64(seed));
    await secureStorage.setSecret(KEYS.mnemonic, mnemonic.trim().toLowerCase().replace(/\s+/g, " "));
    return identity;
  }

  async loadIdentity(): Promise<Identity | null> {
    const seedB64 = await secureStorage.getSecret(KEYS.identityPriv);
    if (!seedB64) return null;
    return this.setFromSeed(fromB64(seedB64));
  }

  async exportRecoveryPhrase(): Promise<string[]> {
    const m = await secureStorage.getSecret(KEYS.mnemonic);
    return m ? m.split(" ") : [];
  }

  getBundle(): SerializedBundle {
    const id = this.ensureId();
    const { spk, opk } = this.mySecrets();
    if (!opk) throw new Error("getBundle: lipsește one-time prekey-ul"); // mySecrets îl derivă mereu; guard pt tip
    const bundle: PreKeyBundle = {
      ikPub: id.ik.pub, edPub: id.ed.pub, spkPub: spk.pub,
      spkSig: sign(id.ed.priv, spk.pub), opkPub: opk.pub,
    };
    return serializeBundle(bundle);
  }

  async startOutbound(peerDid: string, bundle: SerializedBundle): Promise<SessionInfo> {
    const me = this.ensureId();
    const b = deserializeBundle(bundle);
    const { sk, ekPub } = x3dhInitiator(me, b);
    const ratchet = initAlice(sk, b.spkPub);
    const s: Session = { ratchet, safety: safetyNumber(me.ik.pub, b.ikPub), pendingInit: { ik: me.ik.pub, ek: ekPub } };
    this.sessions.set(peerDid, s);
    this.persistSessions();
    return { peerDid, ratchetStep: 0, safetyNumber: s.safety, established: true };
  }

  hasSession(peerDid: string): boolean {
    return this.sessions.has(peerDid);
  }

  async establishSession(peerDid: string, peerBundle?: SerializedBundle): Promise<SessionInfo> {
    if (peerBundle) return this.startOutbound(peerDid, peerBundle);
    const s = this.sessions.get(peerDid);
    if (!s) throw new Error("Fără bundle pentru " + peerDid + " — adu-l de pe releu întâi.");
    return { peerDid, ratchetStep: s.ratchet.Ns, safetyNumber: s.safety, established: true };
  }

  async getSession(peerDid: string): Promise<SessionInfo | null> {
    const s = this.sessions.get(peerDid);
    return s ? { peerDid, ratchetStep: s.ratchet.Ns, safetyNumber: s.safety, established: true } : null;
  }

  async encrypt(peerDid: string, plaintext: string): Promise<CipherEnvelope> {
    const s = this.sessions.get(peerDid);
    if (!s) throw new Error("Fără sesiune cu " + peerDid + " — apelează startOutbound întâi.");
    const { header, ct } = ratchetEncrypt(s.ratchet, padBytes(utf8(plaintext)), adFor(this.myDid(), peerDid));
    const env: CipherEnvelope = {
      fromDid: this.myDid(),
      toDid: peerDid,
      ciphertext: toB64(ct),
      header: headerToB64(header),
      ts: Date.now(),
    };
    if (s.pendingInit) env.prekey = { ik: toB64(s.pendingInit.ik), ek: toB64(s.pendingInit.ek) };
    this.persistSessions(); // ratchet-ul a avansat → salvează
    return env;
  }

  async decrypt(envelope: CipherEnvelope): Promise<DecryptResult> {
    const peer = envelope.fromDid;
    const ad = adFor(peer, this.myDid());
    const header = headerFromB64(envelope.header);
    const ct = fromB64(envelope.ciphertext);
    const s = this.sessions.get(peer);

    // 1) Sesiune existentă: încearcă întâi cu ea (cazul normal).
    if (s) {
      try {
        const pt = ratchetDecrypt(s.ratchet, header, ct, ad);
        s.pendingInit = undefined; // am primit de la ei → nu mai trimitem init
        this.persistSessions();
        return { plaintext: fromUtf8(unpadBytes(pt)), ratchetAdvanced: true };
      } catch (e) {
        // Fără prekey de la care reconstrui → eroare reală.
        if (!envelope.prekey) throw e;
        // Cu prekey → peer-ul s-a RE-PAIRAT (chei/sesiune noi). Reconstruim mai jos.
      }
    } else if (!envelope.prekey) {
      throw new Error("Fără sesiune și fără prekey — nu pot decripta.");
    }

    // 2) (Re)construiește sesiunea ca responder din prekey-ul mesajului.
    //    Acoperă: primul mesaj dintr-o sesiune NOUĂ + RE-PAIRING după ce peer-ul
    //    și-a resetat/restaurat identitatea (B2/B4). Vezi e2ee-messenger.
    const me = this.ensureId();
    const ikA = fromB64(envelope.prekey!.ik);
    const ekA = fromB64(envelope.prekey!.ek);
    const sk = x3dhResponder(me, this.mySecrets(), ikA, ekA);
    const fresh: Session = { ratchet: initBob(sk, this.mySecrets().spk), safety: safetyNumber(me.ik.pub, ikA) };
    const pt = ratchetDecrypt(fresh.ratchet, header, ct, ad); // dacă pică aici, plicul chiar e invalid
    this.sessions.set(peer, fresh); // înlocuiește sesiunea veche spartă
    this.persistSessions();
    return { plaintext: fromUtf8(unpadBytes(pt)), ratchetAdvanced: true };
  }

  /** Re-pairing: scoate sesiunea cu un peer → următorul mesaj re-stabilește X3DH (prekey nou). */
  resetSession(peerDid: string): void {
    this.sessions.delete(peerDid);
    this.persistSessions();
  }

  async computeSafetyNumber(peerDid: string): Promise<string> {
    const s = this.sessions.get(peerDid);
    return s?.safety ?? "";
  }
}
