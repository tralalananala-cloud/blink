/**
 * libsignal — cele 5 stores persistente (Identity/Session/PreKey/SignedPreKey/Kyber).
 * Backend = db.ts (KV criptat ChaCha20 cu dbKey). Records serializate base64.
 *
 * FUNDAȚIE (committed, ne-activată implicit) — verificată de tsc față de .d.ts;
 * runtime-ul E2E se testează pe device (modul nativ, vezi crypto/index.ts switch).
 */
import {
  SessionStore, IdentityKeyStore, PreKeyStore, SignedPreKeyStore, KyberPreKeyStore,
  SessionRecord, PreKeyRecord, SignedPreKeyRecord, KyberPreKeyRecord,
  PrivateKey, PublicKey, ProtocolAddress, Direction,
} from "react-native-libsignal-client";
import { dbGetItem, dbSetItem, dbRemoveItem } from "../../storage/db";
import { toB64, fromB64 } from "../signal/primitives";

const P = "ls.";
const addrKey = (a: ProtocolAddress) => a.name + "." + a.deviceId;
const put = (k: string, b: Uint8Array) => dbSetItem(P + k, toB64(b));
async function get(k: string): Promise<Uint8Array | null> {
  const v = await dbGetItem(P + k);
  return v ? fromB64(v) : null;
}

export class DbSessionStore extends SessionStore {
  async saveSession(name: ProtocolAddress, record: SessionRecord): Promise<void> {
    await put("sess." + addrKey(name), record.serialized);
  }
  async getSession(name: ProtocolAddress): Promise<SessionRecord | null> {
    const b = await get("sess." + addrKey(name));
    return b ? SessionRecord._fromSerialized(b) : null;
  }
  async getExistingSessions(addresses: ProtocolAddress[]): Promise<SessionRecord[]> {
    const out: SessionRecord[] = [];
    for (const a of addresses) { const s = await this.getSession(a); if (s) out.push(s); }
    return out;
  }
  /** A2 rollback: readuce sesiunea la un snapshot anterior (sau o șterge dacă nu exista). */
  async restoreSession(name: ProtocolAddress, prev: SessionRecord | null): Promise<void> {
    if (prev) await put("sess." + addrKey(name), prev.serialized);
    else await dbRemoveItem(P + "sess." + addrKey(name));
  }
}

export class DbIdentityStore extends IdentityKeyStore {
  constructor(private idKey: PrivateKey, private regId: number) { super(); }
  async getIdentityKey(): Promise<PrivateKey> { return this.idKey; }
  async getLocalRegistrationId(): Promise<number> { return this.regId; }
  async saveIdentity(name: ProtocolAddress, key: PublicKey): Promise<boolean> {
    const prev = await this.getIdentity(name);
    await put("id." + addrKey(name), key.serialized);
    // true = identitatea s-a SCHIMBAT (cheie nouă pt un contact cunoscut)
    return prev != null && toB64(prev.serialized) !== toB64(key.serialized);
  }
  async getIdentity(name: ProtocolAddress): Promise<PublicKey | null> {
    const b = await get("id." + addrKey(name));
    return b ? PublicKey._fromSerialized(b) : null;
  }
  // TOFU: acceptă la prima vedere; dacă cheia diferă de cea cunoscută → netrust (re-pair).
  async isTrustedIdentity(name: ProtocolAddress, key: PublicKey, _dir: Direction): Promise<boolean> {
    const known = await this.getIdentity(name);
    return known == null || toB64(known.serialized) === toB64(key.serialized);
  }
  /** A2 rollback: readuce identitatea la un snapshot anterior (sau o șterge dacă nu exista) —
   *  anulează scrierea făcută de un mesaj PreKey sealed cu `sd` forjat (anti-otrăvire TOFU). */
  async restoreIdentity(name: ProtocolAddress, prev: PublicKey | null): Promise<void> {
    if (prev) await put("id." + addrKey(name), prev.serialized);
    else await dbRemoveItem(P + "id." + addrKey(name));
  }
}

export class DbPreKeyStore extends PreKeyStore {
  async savePreKey(id: number, record: PreKeyRecord): Promise<void> { await put("pk." + id, record.serialized); }
  async getPreKey(id: number): Promise<PreKeyRecord> {
    const b = await get("pk." + id);
    if (!b) throw new Error("PreKey lipsă: " + id);
    return PreKeyRecord._fromSerialized(b);
  }
  async removePreKey(id: number): Promise<void> {
    if (id === 1) return; // #4: prekey LAST-RESORT (id=1) e reutilizabil → NU-l ștergem (fallback când poolul e gol)
    await dbRemoveItem(P + "pk." + id);
  }
}

export class DbSignedPreKeyStore extends SignedPreKeyStore {
  async saveSignedPreKey(id: number, record: SignedPreKeyRecord): Promise<void> { await put("spk." + id, record.serialized); }
  async getSignedPreKey(id: number): Promise<SignedPreKeyRecord> {
    const b = await get("spk." + id);
    if (!b) throw new Error("SignedPreKey lipsă: " + id);
    return SignedPreKeyRecord._fromSerialized(b);
  }
}

export class DbKyberPreKeyStore extends KyberPreKeyStore {
  async saveKyberPreKey(id: number, record: KyberPreKeyRecord): Promise<void> { await put("kpk." + id, record.serialized); }
  async getKyberPreKey(id: number): Promise<KyberPreKeyRecord> {
    const b = await get("kpk." + id);
    if (!b) throw new Error("KyberPreKey lipsă: " + id);
    return KyberPreKeyRecord._fromSerialized(b);
  }
  async markKyberPreKeyUsed(_id: number): Promise<void> { /* prekey-uri last-resort: nu le scoatem */ }
}
