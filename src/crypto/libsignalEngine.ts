/**
 * LibsignalEngine — motor cripto peste libsignal OFICIAL (react-native-libsignal-client):
 * X3DH + Double Ratchet auditat, PQXDH/Kyber (post-quantum), zeroizare nativă.
 * Implementează aceeași interfață CryptoEngine ca SignalEngine → UI neatins.
 *
 * ⚠️ FUNDAȚIE: type-correct (tsc față de .d.ts), dar NEVERIFICAT E2E pe device.
 * Modul NATIV → rulează doar în APK prebuild, NU în Expo Go. Activare prin
 * crypto/index.ts (USE_LIBSIGNAL). Format pe sârmă nou → toți re-pairează.
 */
// PRIMUL — instalează globalele base64 ÎNAINTE ca react-native-libsignal-client (și
// dependența lui @craftzdog/react-native-buffer) să încarce react-native-quick-base64.
// Fără asta: crash "QuickBase64 could not be found" (TurboModule getEnforcing) la pornire.
import "./libsignal/quickBase64Polyfill";
import {
  PrivateKey, PublicKey, KEMPublicKey, ProtocolAddress,
  PreKeyRecord, SignedPreKeyRecord, KyberPreKeyRecord,
  SignalMessage, PreKeySignalMessage,
  generateRegistrationID, createAndProcessPreKeyBundle,
  signalEncrypt, signalDecrypt, signalDecryptPreKey,
  CiphertextMessageType,
} from "react-native-libsignal-client";
import {
  CryptoEngine, Identity, SerializedBundle, SessionInfo, CipherEnvelope, DecryptResult,
  SealedEnvelope, SealedDecryptResult,
} from "./types";
import { KEYS, secureStorage } from "../storage/secure";
import { toB64, fromB64, hash, hkdfBytes, aeadEncrypt, aeadDecrypt, rand, concat, utf8, fromUtf8 } from "./signal/primitives";
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from "../identity/did";
import {
  DbSessionStore, DbIdentityStore, DbPreKeyStore, DbSignedPreKeyStore, DbKyberPreKeyStore,
} from "./libsignal/stores";

const DEVICE_ID = 1;
const PREKEY_ID = 1;
const SIGNED_PREKEY_ID = 1;
const KYBER_PREKEY_ID = 1;

// UTF-8 corect (emoji) — fără a depinde de TextEncoder (absent în unele runtime-uri).
function enc(s: string): Uint8Array {
  const bin = unescape(encodeURIComponent(s));
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
function dec(b: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return decodeURIComponent(escape(bin));
}
function didFrom(idPub: PublicKey): string {
  return "did:key:z6Mk" + toB64(idPub.serialized).replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
}

/**
 * Safety number = fingerprint comun al celor două identități, pt verificare anti-MITM
 * (compari codul cu prietenul față-în-față / pe alt canal). Determinist + simetric:
 * sortăm cele două chei publice canonical, hash iterat (anti-precomputare), 60 cifre.
 * Nu e formatul exact Signal (binding-ul n-are Fingerprint API) dar e criptografic corect:
 * identic pe ambele capete DOAR dacă fiecare deține cheia reală a celuilalt.
 */
function safetyDigits(a: Uint8Array, b: Uint8Array): string {
  const [x, y] = toB64(a) < toB64(b) ? [a, b] : [b, a];
  let h = hash(new Uint8Array([...x, ...y]));
  for (let i = 0; i < 16; i++) h = hash(h);
  let digits = "";
  for (let i = 0; i < 60; i++) digits += (h[i % h.length] % 10).toString();
  return digits.match(/.{1,5}/g)!.join(" ");
}

export class LibsignalEngine implements CryptoEngine {
  readonly isSecure = true;
  // libsignal (primitivele) e auditat, DAR integrarea noastră (sealed sender ECDH box,
  // safety number, stores) NU e auditată independent → nu afișăm „AUDITED" (onestitate).
  readonly isAudited = false;
  readonly name = "libsignal (PQXDH + Double Ratchet, post-quantum)";

  private idKey: PrivateKey | null = null;
  private regId = 0;
  private identity: Identity | null = null;
  private sessionStore = new DbSessionStore();
  private preKeyStore = new DbPreKeyStore();
  private signedPreKeyStore = new DbSignedPreKeyStore();
  private kyberStore = new DbKyberPreKeyStore();
  private idStore: DbIdentityStore | null = null;
  private known = new Set<string>(); // cache sync pt hasSession (peeri cu sesiune)
  // Cheile publice proprii pt bundle (cache sync — getBundle e sync, store-ul e async)
  private bundlePub: { preKey: string; signedPreKey: string; signedPreKeySig: string; kyberPreKey: string; kyberPreKeySig: string } | null = null;

  private ensureKey(): PrivateKey {
    if (!this.idKey) throw new Error("LibsignalEngine: identitate neinițializată");
    return this.idKey;
  }
  private ident(): DbIdentityStore {
    if (!this.idStore) throw new Error("LibsignalEngine: store identitate neinițializat");
    return this.idStore;
  }

  private build(idKey: PrivateKey, regId: number): Identity {
    this.idKey = idKey;
    this.regId = regId;
    this.idStore = new DbIdentityStore(idKey, regId);
    const pub = idKey.getPublicKey();
    this.identity = {
      did: didFrom(pub), publicKey: toB64(pub.serialized),
      fingerprint: toB64(pub.serialized).slice(0, 32).toUpperCase().match(/.{1,4}/g)!.join(" "),
      createdAt: Date.now(),
    };
    return this.identity;
  }

  /** Generează prekey/signed/kyber proprii, le salvează și cachează publicele pt bundle. */
  private async genPrekeys(): Promise<void> {
    const idKey = this.ensureKey();
    // Generarea cheilor e sincronă (nativ Rust); doar scrierile sunt async și INDEPENDENTE
    // (chei db distincte = fișiere distincte, fără race) → le rulăm în paralel.
    const pk = PrivateKey.generate();
    const spk = PrivateKey.generate();
    const spkSig = idKey.sign(spk.getPublicKey().serialized);
    const kyberRec = KyberPreKeyRecord.new(KYBER_PREKEY_ID, Date.now(), idKey.serialized);
    await Promise.all([
      this.preKeyStore.savePreKey(PREKEY_ID, PreKeyRecord.new(PREKEY_ID, pk.getPublicKey(), pk)),
      this.signedPreKeyStore.saveSignedPreKey(
        SIGNED_PREKEY_ID, SignedPreKeyRecord.new(SIGNED_PREKEY_ID, Date.now(), spk.getPublicKey(), spk, spkSig),
      ),
      this.kyberStore.saveKyberPreKey(KYBER_PREKEY_ID, kyberRec),
    ]);
    this.bundlePub = {
      preKey: toB64(pk.getPublicKey().serialized),
      signedPreKey: toB64(spk.getPublicKey().serialized),
      signedPreKeySig: toB64(spkSig),
      kyberPreKey: toB64(kyberRec.publicKey().serialized),
      kyberPreKeySig: toB64(kyberRec.signature()),
    };
  }

  async generateIdentity(): Promise<Identity> {
    const mnemonic = generateMnemonic().join(" ");
    const idKey = PrivateKey._fromSerialized(mnemonicToSeed(mnemonic)); // determinist din frază (restore)
    const regId = generateRegistrationID();
    const identity = this.build(idKey, regId);
    // scrieri independente (chei SecureStore distincte) → paralel
    await Promise.all([
      secureStorage.setSecret(KEYS.identityPriv, toB64(idKey.serialized)),
      secureStorage.setSecret(KEYS.mnemonic, mnemonic),
      secureStorage.setSecret("ls.regId", String(regId)),
    ]);
    await this.genPrekeys();
    return identity;
  }

  async restoreIdentity(mnemonic: string): Promise<Identity> {
    if (!validateMnemonic(mnemonic)) throw new Error("Frază de recuperare invalidă");
    const m = mnemonic.trim().toLowerCase().replace(/\s+/g, " ");
    const idKey = PrivateKey._fromSerialized(mnemonicToSeed(m));
    const regId = generateRegistrationID();
    const identity = this.build(idKey, regId);
    await Promise.all([
      secureStorage.setSecret(KEYS.identityPriv, toB64(idKey.serialized)),
      secureStorage.setSecret(KEYS.mnemonic, m),
      secureStorage.setSecret("ls.regId", String(regId)),
    ]);
    await this.genPrekeys(); // prekey-uri noi (sesiunile vechi oricum nu se mai pot relua)
    return identity;
  }

  async loadIdentity(): Promise<Identity | null> {
    const b64 = await secureStorage.getSecret(KEYS.identityPriv);
    if (!b64) return null;
    const regId = Number((await secureStorage.getSecret("ls.regId")) || "0");
    const identity = this.build(PrivateKey._fromSerialized(fromB64(b64)), regId);
    // re-populează bundle-ul public din store; dacă lipsește, regenerează prekey-urile
    try {
      const pk = await this.preKeyStore.getPreKey(PREKEY_ID);
      const spk = await this.signedPreKeyStore.getSignedPreKey(SIGNED_PREKEY_ID);
      const kpk = await this.kyberStore.getKyberPreKey(KYBER_PREKEY_ID);
      this.bundlePub = {
        preKey: toB64(pk.publicKey().serialized),
        signedPreKey: toB64(spk.publicKey().serialized), signedPreKeySig: toB64(spk.signature()),
        kyberPreKey: toB64(kpk.publicKey().serialized), kyberPreKeySig: toB64(kpk.signature()),
      };
    } catch { await this.genPrekeys(); }
    return identity;
  }

  async exportRecoveryPhrase(): Promise<string[]> {
    const m = await secureStorage.getSecret(KEYS.mnemonic);
    return m ? m.split(" ") : [];
  }

  getBundle(): SerializedBundle {
    // Bundle-ul libsignal complet (chei publice), purtat prin releu în câmpul opac `ls`.
    const idPub = this.ensureKey().getPublicKey();
    if (!this.bundlePub) throw new Error("Bundle public neinițializat — generează/încarcă identitatea întâi");
    const ls = JSON.stringify({
      regId: this.regId, idKey: toB64(idPub.serialized),
      preKeyId: PREKEY_ID, preKey: this.bundlePub.preKey,
      signedPreKeyId: SIGNED_PREKEY_ID, signedPreKey: this.bundlePub.signedPreKey, signedPreKeySig: this.bundlePub.signedPreKeySig,
      kyberPreKeyId: KYBER_PREKEY_ID, kyberPreKey: this.bundlePub.kyberPreKey, kyberPreKeySig: this.bundlePub.kyberPreKeySig,
    });
    return { ikPub: toB64(idPub.serialized), edPub: "", spkPub: "", spkSig: "", ls };
  }

  async startOutbound(peerDid: string, bundle: SerializedBundle): Promise<SessionInfo> {
    if (!bundle.ls) throw new Error("Bundle fără date libsignal (ls)");
    // Bundle-ul peer-ului e publicat de getBundle-ul LUI; aici avem nevoie de prekey-urile
    // lui publice. NOTĂ: getBundle de mai sus trebuie extins să includă prekey/signed/kyber
    // publice ale emitentului (vezi TODO device-test). Folosim createAndProcessPreKeyBundle.
    const b = JSON.parse(bundle.ls) as any;
    const addr = new ProtocolAddress(peerDid, DEVICE_ID);
    await createAndProcessPreKeyBundle(
      b.regId, addr,
      b.preKeyId ?? PREKEY_ID, PublicKey._fromSerialized(fromB64(b.preKey)),
      b.signedPreKeyId ?? SIGNED_PREKEY_ID, PublicKey._fromSerialized(fromB64(b.signedPreKey)),
      fromB64(b.signedPreKeySig), PublicKey._fromSerialized(fromB64(b.idKey)),
      this.sessionStore, this.ident(),
      b.kyberPreKey
        ? { kyber_prekey_id: b.kyberPreKeyId ?? KYBER_PREKEY_ID, kyber_prekey: KEMPublicKey._fromSerialized(fromB64(b.kyberPreKey)), kyber_prekey_signature: fromB64(b.kyberPreKeySig) }
        : null,
    );
    this.known.add(peerDid);
    return { peerDid, ratchetStep: 0, safetyNumber: "", established: true };
  }

  hasSession(peerDid: string): boolean { return this.known.has(peerDid); }

  async establishSession(peerDid: string, peerBundle?: unknown): Promise<SessionInfo> {
    if (peerBundle) return this.startOutbound(peerDid, peerBundle as SerializedBundle);
    return { peerDid, ratchetStep: 0, safetyNumber: "", established: this.known.has(peerDid) };
  }
  async getSession(peerDid: string): Promise<SessionInfo | null> {
    return this.known.has(peerDid) ? { peerDid, ratchetStep: 0, safetyNumber: "", established: true } : null;
  }

  async encrypt(peerDid: string, plaintext: string): Promise<CipherEnvelope> {
    const addr = new ProtocolAddress(peerDid, DEVICE_ID);
    const msg = await signalEncrypt(enc(plaintext), addr, this.sessionStore, this.ident());
    this.known.add(peerDid);
    return {
      fromDid: this.identity?.did ?? "self", toDid: peerDid,
      ciphertext: toB64(msg.serialized), header: String(msg.type()), ts: Date.now(),
    };
  }

  async decrypt(envelope: CipherEnvelope): Promise<DecryptResult> {
    const addr = new ProtocolAddress(envelope.fromDid, DEVICE_ID);
    const body = fromB64(envelope.ciphertext);
    let pt: Uint8Array;
    if (Number(envelope.header) === CiphertextMessageType.PreKey) {
      pt = await signalDecryptPreKey(
        PreKeySignalMessage._fromSerialized(body), addr,
        this.sessionStore, this.ident(), this.preKeyStore, this.signedPreKeyStore, this.kyberStore, [KYBER_PREKEY_ID],
      );
    } else {
      pt = await signalDecrypt(SignalMessage._fromSerialized(body), addr, this.sessionStore, this.ident());
    }
    this.known.add(envelope.fromDid);
    return { plaintext: dec(pt), ratchetAdvanced: true };
  }

  async computeSafetyNumber(peerDid: string): Promise<string> {
    if (!this.idKey || !this.idStore) return "";
    const peerPub = await this.idStore.getIdentity(new ProtocolAddress(peerDid, DEVICE_ID));
    if (!peerPub) return ""; // încă n-avem cheia peer-ului (înainte de prima sesiune)
    return safetyDigits(this.idKey.getPublicKey().serialized, peerPub.serialized);
  }

  // ── Sealed sender (#2 metadate) ──────────────────────────────────────────────
  /**
   * Strat sealed propriu (ECDH box), NU SenderCertificate native (binding-ul 0.1.44
   * respinge senderCertificateNew). Criptăm {senderDid + mesajul libsignal} către cheia
   * de identitate a destinatarului, cu o cheie efemeră → releul vede doar un blob opac +
   * destinatarul (toDid, necesar la rutare). Expeditorul se află DOAR după decriptare.
   * ECDH = PrivateKey.agree (X25519 nativ libsignal); AEAD/HKDF = @noble (auditat).
   * Conținutul real rămâne protejat de Double Ratchet (mesajul libsignal din interior).
   * Format blob: [ephLen(1)] [ephPub] [nonce(12)] [ciphertext].
   */
  async encryptSealed(peerDid: string, plaintext: string): Promise<SealedEnvelope> {
    const addr = new ProtocolAddress(peerDid, DEVICE_ID);
    const inner = await signalEncrypt(enc(plaintext), addr, this.sessionStore, this.ident()); // ratchet normal
    const peerPub = await this.ident().getIdentity(addr);
    if (!peerPub) throw new Error("Fără cheia de identitate a peer-ului (stabilește sesiunea întâi)");
    const eph = PrivateKey.generate();
    const shared = eph.agree(peerPub);
    const key = hkdfBytes(shared, new Uint8Array(0), "blink-sealed-v1", 32);
    const nonce = rand(12);
    const payload = utf8(JSON.stringify({ sd: this.identity?.did ?? didFrom(this.ensureKey().getPublicKey()), t: inner.type(), c: toB64(inner.serialized) }));
    const ct = aeadEncrypt(key, nonce, payload, new Uint8Array(0));
    const ephPub = eph.getPublicKey().serialized;
    const blob = concat(new Uint8Array([ephPub.length]), ephPub, nonce, ct);
    this.known.add(peerDid);
    return { toDid: peerDid, sealed: toB64(blob), ts: Date.now() };
  }

  async decryptSealed(env: SealedEnvelope): Promise<SealedDecryptResult> {
    const blob = fromB64(env.sealed);
    const ephLen = blob[0];
    const ephPub = blob.slice(1, 1 + ephLen);
    const nonce = blob.slice(1 + ephLen, 1 + ephLen + 12);
    const ct = blob.slice(1 + ephLen + 12);
    const shared = this.ensureKey().agree(PublicKey._fromSerialized(ephPub));
    const key = hkdfBytes(shared, new Uint8Array(0), "blink-sealed-v1", 32);
    const payload = JSON.parse(fromUtf8(aeadDecrypt(key, nonce, ct, new Uint8Array(0))));
    const fromDid: string = payload.sd;
    const addr = new ProtocolAddress(fromDid, DEVICE_ID);
    const body = fromB64(payload.c);
    let pt: Uint8Array;
    if (payload.t === CiphertextMessageType.PreKey) {
      pt = await signalDecryptPreKey(
        PreKeySignalMessage._fromSerialized(body), addr,
        this.sessionStore, this.ident(), this.preKeyStore, this.signedPreKeyStore, this.kyberStore, [KYBER_PREKEY_ID],
      );
    } else {
      pt = await signalDecrypt(SignalMessage._fromSerialized(body), addr, this.sessionStore, this.ident());
    }
    this.known.add(fromDid);
    return { plaintext: dec(pt), ratchetAdvanced: true, fromDid };
  }

  clearIdentity(): void {
    this.idKey = null; this.regId = 0; this.identity = null; this.idStore = null; this.known.clear();
  }
  resetSession(peerDid: string): void { this.known.delete(peerDid); /* sesiunea din store: suprascrisă la următorul prekey */ }
}
