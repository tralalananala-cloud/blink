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
import { dbGetItem, dbSetItem } from "../storage/db";
import { toB64, fromB64, hash, hkdfBytes, aeadEncrypt, aeadDecrypt, rand, concat, utf8, fromUtf8 } from "./signal/primitives";
import { didFromKeys as didFrom, deriveAuthKey, signNonce } from "./identity";
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from "../identity/did";
import {
  DbSessionStore, DbIdentityStore, DbPreKeyStore, DbSignedPreKeyStore, DbKyberPreKeyStore,
} from "./libsignal/stores";

const DEVICE_ID = 1;
const PREKEY_ID = 1; // prekey LAST-RESORT (reutilizabil, niciodată șters) — fallback când poolul e gol
const SIGNED_PREKEY_ID = 1;
const KYBER_PREKEY_ID = 1;
// #4 pool de one-time prekey-uri: id-uri monotone ≥ OPK_BASE, batch nou la fiecare reg.
const OPK_BASE = 1000;
const OPK_POOL = 50;   // câte generăm per reg
const OPK_KEEP = 150;  // câte privates păstrăm în store (mărginit; ștergem cele mai vechi)
const SPK_MAX_AGE = 7 * 24 * 3600 * 1000; // rotește signed prekey-ul după 7 zile

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
// DID + cheia de auth + base32 = helperi PURI în ./identity (testabili fără modulul nativ).

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
  // Cheia de autentificare la releu (Ed25519), derivată determinist din idKey (deci din seed).
  // Releul o verifică cu WebCrypto; intră și în preimaginea DID-ului → nu poate fi substituită.
  private authPriv: Uint8Array | null = null;
  private authPub: Uint8Array | null = null;
  private sessionStore = new DbSessionStore();
  private preKeyStore = new DbPreKeyStore();
  private signedPreKeyStore = new DbSignedPreKeyStore();
  private kyberStore = new DbKyberPreKeyStore();
  private idStore: DbIdentityStore | null = null;
  private known = new Set<string>(); // cache sync pt hasSession (peeri cu sesiune)
  // Cheile publice proprii pt bundle (cache sync — getBundle e sync, store-ul e async)
  private bundlePub: { preKey: string; signedPreKey: string; signedPreKeySig: string; kyberPreKey: string; kyberPreKeySig: string } | null = null;
  // #4 batch curent de one-time prekey-uri (publice) de urcat la reg; releul le POPează.
  private opkBatch: { id: number; pub: string }[] = [];

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
    // cheie de auth releu, deterministă din idKey (supraviețuiește restore/restart)
    const ak = deriveAuthKey(idKey.serialized);
    this.authPriv = ak.priv;
    this.authPub = ak.pub;
    this.identity = {
      did: didFrom(pub.serialized, this.authPub), publicKey: toB64(pub.serialized),
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
    await dbSetItem("ls.spkTs", String(Date.now())); // #4 marcaj pt rotația signed prekey-ului
  }

  /**
   * #4 — Pool de one-time prekey-uri: generează un batch nou cu id-uri MONOTONE (≥ OPK_BASE),
   * îl salvează în store și îl pune în coadă pt urcare la reg. Releul ține poolul și POPează
   * câte un opk per getbundle → fiecare contact primește un opk DIFERIT (one-time real), nu
   * același reutilizat la infinit. Store mărginit: păstrăm doar ultimele OPK_KEEP private.
   */
  private async replenishOpks(): Promise<void> {
    try {
      let next = Number((await dbGetItem("ls.opkNext")) || String(OPK_BASE));
      const live: number[] = JSON.parse((await dbGetItem("ls.opkLive")) || "[]");
      const batch: { id: number; pub: string }[] = [];
      for (let i = 0; i < OPK_POOL; i++) {
        const id = next++;
        const pk = PrivateKey.generate();
        await this.preKeyStore.savePreKey(id, PreKeyRecord.new(id, pk.getPublicKey(), pk));
        batch.push({ id, pub: toB64(pk.getPublicKey().serialized) });
        live.push(id);
      }
      while (live.length > OPK_KEEP) { const old = live.shift()!; await this.preKeyStore.removePreKey(old); }
      await dbSetItem("ls.opkNext", String(next));
      await dbSetItem("ls.opkLive", JSON.stringify(live));
      this.opkBatch = batch;
    } catch { this.opkBatch = []; }
  }

  /** #4 — rotește signed prekey-ul dacă e mai vechi de SPK_MAX_AGE (re-publică bundle-ul). */
  private async rotateSignedPreKeyIfStale(): Promise<void> {
    try {
      const ts = Number((await dbGetItem("ls.spkTs")) || "0");
      if (Date.now() - ts < SPK_MAX_AGE || !this.idKey) return;
      const spk = PrivateKey.generate();
      const spkSig = this.idKey.sign(spk.getPublicKey().serialized);
      await this.signedPreKeyStore.saveSignedPreKey(
        SIGNED_PREKEY_ID, SignedPreKeyRecord.new(SIGNED_PREKEY_ID, Date.now(), spk.getPublicKey(), spk, spkSig),
      );
      if (this.bundlePub) {
        this.bundlePub.signedPreKey = toB64(spk.getPublicKey().serialized);
        this.bundlePub.signedPreKeySig = toB64(spkSig);
      }
      await dbSetItem("ls.spkTs", String(Date.now()));
    } catch {}
  }

  /** Batch-ul curent de one-time prekey-uri (publice) de urcat la reg. */
  getOpkBatch(): { id: number; pub: string }[] { return this.opkBatch; }

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
    await this.replenishOpks(); // #4 pool de one-time prekey-uri
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
    await this.replenishOpks(); // #4 pool de one-time prekey-uri
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
    await this.rotateSignedPreKeyIfStale(); // #4 rotește signed prekey-ul dacă e vechi
    await this.replenishOpks(); // #4 batch nou de one-time prekey-uri la fiecare pornire
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
      authPub: toB64(this.authPub!), // intră în preimaginea DID-ului → binding verificabil de peer + releu
    });
    return { ikPub: toB64(idPub.serialized), edPub: "", spkPub: "", spkSig: "", ls };
  }

  async startOutbound(peerDid: string, bundle: SerializedBundle): Promise<SessionInfo> {
    if (!bundle.ls) throw new Error("Bundle fără date libsignal (ls)");
    // Bundle-ul peer-ului e publicat de getBundle-ul LUI; aici avem nevoie de prekey-urile
    // lui publice. NOTĂ: getBundle de mai sus trebuie extins să includă prekey/signed/kyber
    // publice ale emitentului (vezi TODO device-test). Folosim createAndProcessPreKeyBundle.
    const b = JSON.parse(bundle.ls) as any;
    // BINDING ANTI-MITM (C2): DID-ul e sha256(idKey) (vezi didFrom). Verifică că bundle-ul
    // livrat de releu chiar aparține DID-ului cerut — altfel un releu compromis poate
    // substitui cheia și face MITM la primul contact, deși ai scanat DID-ul corect.
    if (!b.authPub) throw new Error("Bundle fără authPub (client incompatibil) — re-pair necesar");
    const peerIdPub = PublicKey._fromSerialized(fromB64(b.idKey));
    if (didFrom(peerIdPub.serialized, fromB64(b.authPub)) !== peerDid) {
      throw new Error("Bundle: cheile nu corespund DID-ului scanat (posibil MITM releu)");
    }
    // #4: folosește one-time prekey-ul POPat de releu (unic pt acest contact); fallback la
    // prekey-ul last-resort din bundle (reutilizabil) când poolul peer-ului e gol.
    const opkId = bundle.opk?.pub ? bundle.opk.id : (b.preKeyId ?? PREKEY_ID);
    const opkPub = bundle.opk?.pub ?? b.preKey;
    const addr = new ProtocolAddress(peerDid, DEVICE_ID);
    await createAndProcessPreKeyBundle(
      b.regId, addr,
      opkId, PublicKey._fromSerialized(fromB64(opkPub)),
      b.signedPreKeyId ?? SIGNED_PREKEY_ID, PublicKey._fromSerialized(fromB64(b.signedPreKey)),
      fromB64(b.signedPreKeySig), peerIdPub,
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
    const sd = this.identity?.did ?? didFrom(this.ensureKey().getPublicKey().serialized, this.authPub!);
    const payload = utf8(JSON.stringify({ sd, t: inner.type(), c: toB64(inner.serialized) }));
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
    // #6 — `sd` e auto-declarat în interiorul plicului. Autenticitatea REALĂ vine de la
    // libsignal: mesajul interior se decriptează DOAR sub sesiunea lui `sd` (un `sd` fals
    // n-ar avea sesiunea potrivită → signalDecrypt aruncă). Gardă defensivă: respinge un `sd`
    // malformat înainte de a-l folosi ca ProtocolAddress (evită poluarea store-ului cu nume bizare).
    if (typeof fromDid !== "string" || !/^did:key:z[A-Za-z0-9]{16,}$/.test(fromDid)) {
      throw new Error("sealed: expeditor (sd) invalid");
    }
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

  /** Auth releu (C1): semnează nonce-ul cu cheia Ed25519 derivată din seed. Releul verifică
   *  semnătura + că did === didFrom(idKey, authPub) → dovedește proprietatea DID-ului. */
  signChallenge(nonce: string): { pub: string; sig: string } {
    if (!this.authPriv || !this.authPub) throw new Error("Cheie de auth neinițializată");
    return { pub: toB64(this.authPub), sig: toB64(signNonce(this.authPriv, nonce)) };
  }

  clearIdentity(): void {
    this.idKey = null; this.regId = 0; this.identity = null; this.idStore = null;
    this.authPriv = null; this.authPub = null; this.known.clear();
  }
  resetSession(peerDid: string): void { this.known.delete(peerDid); /* sesiunea din store: suprascrisă la următorul prekey */ }
}
