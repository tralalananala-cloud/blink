/**
 * Double Ratchet — implementare după specificația Signal (signal.org/docs).
 * Peste primitivele auditate din ./primitives. Oferă forward secrecy +
 * post-compromise security. Suportă mesaje out-of-order (skipped keys).
 *
 * Notă onestă: protocolul e implementat aici (cu teste), nu importat din
 * libsignal oficial. Vezi roadmap Faza 2b (bridge nativ libsignal).
 */
import {
  aeadDecrypt,
  aeadEncrypt,
  Bytes,
  concat,
  dh,
  equal,
  fromB64,
  genDH,
  hkdfBytes,
  hmacSha256,
  KeyPair,
  toB64,
  utf8,
} from "./primitives";

const MAX_SKIP = 256;

export interface Header {
  dh: Bytes; // cheia publică de ratchet a expeditorului
  pn: number; // lungimea lanțului anterior
  n: number; // numărul mesajului în lanțul curent
}

export interface RatchetState {
  DHs: KeyPair;
  DHr: Bytes | null;
  RK: Bytes;
  CKs: Bytes | null;
  CKr: Bytes | null;
  Ns: number;
  Nr: number;
  PN: number;
  skipped: Map<string, Bytes>;
}

// KDF pe root key: (RK, ck) = HKDF(salt=RK, ikm=dhOut)
function kdfRoot(rk: Bytes, dhOut: Bytes): [Bytes, Bytes] {
  const out = hkdfBytes(dhOut, rk, "Cipher_DoubleRatchet_Root", 64);
  return [out.slice(0, 32), out.slice(32, 64)];
}
// KDF pe chain key: ck' = HMAC(ck, 0x02); mk = HMAC(ck, 0x01)
function kdfChain(ck: Bytes): [Bytes, Bytes] {
  const mk = hmacSha256(ck, new Uint8Array([0x01]));
  const nextCk = hmacSha256(ck, new Uint8Array([0x02]));
  return [nextCk, mk];
}
// din message key derivăm cheia AEAD (32) + nonce (12)
function msgKeys(mk: Bytes): { key: Bytes; nonce: Bytes } {
  const out = hkdfBytes(mk, new Uint8Array(32), "Cipher_MessageKeys", 44);
  return { key: out.slice(0, 32), nonce: out.slice(32, 44) };
}

export function serializeHeader(h: Header): Bytes {
  // dh(32) || pn(4) || n(4)
  const meta = new Uint8Array(8);
  new DataView(meta.buffer).setUint32(0, h.pn);
  new DataView(meta.buffer).setUint32(4, h.n);
  return concat(h.dh, meta);
}

export function initAlice(sk: Bytes, bobRatchetPub: Bytes): RatchetState {
  const DHs = genDH();
  const [RK, CKs] = kdfRoot(sk, dh(DHs.priv, bobRatchetPub));
  return { DHs, DHr: bobRatchetPub, RK, CKs, CKr: null, Ns: 0, Nr: 0, PN: 0, skipped: new Map() };
}

export function initBob(sk: Bytes, bobRatchetKey: KeyPair): RatchetState {
  return { DHs: bobRatchetKey, DHr: null, RK: sk, CKs: null, CKr: null, Ns: 0, Nr: 0, PN: 0, skipped: new Map() };
}

export function ratchetEncrypt(st: RatchetState, plaintext: Bytes, ad: Bytes): { header: Header; ct: Bytes } {
  if (!st.CKs) throw new Error("ratchet: niciun lanț de trimitere (sesiune neinițializată corect)");
  const [ck, mk] = kdfChain(st.CKs);
  st.CKs = ck;
  const header: Header = { dh: st.DHs.pub, pn: st.PN, n: st.Ns };
  st.Ns += 1;
  const { key, nonce } = msgKeys(mk);
  const adFull = concat(ad, serializeHeader(header));
  const ct = aeadEncrypt(key, nonce, plaintext, adFull);
  return { header, ct };
}

export function ratchetDecrypt(st: RatchetState, header: Header, ct: Bytes, ad: Bytes): Bytes {
  const skKey = skippedKey(header.dh, header.n);
  const skipped = st.skipped.get(skKey);
  if (skipped) {
    st.skipped.delete(skKey);
    return decryptWith(skipped, header, ct, ad);
  }
  if (!st.DHr || !equal(header.dh, st.DHr)) {
    skipMessageKeys(st, header.pn);
    dhRatchet(st, header);
  }
  skipMessageKeys(st, header.n);
  if (!st.CKr) throw new Error("ratchet: niciun lanț de primire");
  const [ck, mk] = kdfChain(st.CKr);
  st.CKr = ck;
  st.Nr += 1;
  return decryptWith(mk, header, ct, ad);
}

function decryptWith(mk: Bytes, header: Header, ct: Bytes, ad: Bytes): Bytes {
  const { key, nonce } = msgKeys(mk);
  const adFull = concat(ad, serializeHeader(header));
  return aeadDecrypt(key, nonce, ct, adFull);
}

function skippedKey(dhPub: Bytes, n: number): string {
  return `${toB64(dhPub)}:${n}`;
}

function skipMessageKeys(st: RatchetState, until: number): void {
  if (st.Nr + MAX_SKIP < until) throw new Error("ratchet: prea multe mesaje sărite");
  if (!st.CKr) return;
  while (st.Nr < until) {
    const [ck, mk] = kdfChain(st.CKr);
    st.CKr = ck;
    st.skipped.set(skippedKey(st.DHr!, st.Nr), mk);
    st.Nr += 1;
  }
}

function dhRatchet(st: RatchetState, header: Header): void {
  st.PN = st.Ns;
  st.Ns = 0;
  st.Nr = 0;
  st.DHr = header.dh;
  let [rk, ckr] = kdfRoot(st.RK, dh(st.DHs.priv, st.DHr));
  st.RK = rk;
  st.CKr = ckr;
  st.DHs = genDH();
  let [rk2, cks] = kdfRoot(st.RK, dh(st.DHs.priv, st.DHr));
  st.RK = rk2;
  st.CKs = cks;
}

// serializare header pentru transport (base64 JSON-safe)
export function headerToB64(h: Header): string {
  return toB64(concat(h.dh, encodeNums(h.pn, h.n)));
}
export function headerFromB64(s: string): Header {
  const raw = fromB64(s);
  const dhPub = raw.slice(0, 32);
  const dv = new DataView(raw.buffer, raw.byteOffset + 32, 8);
  return { dh: dhPub, pn: dv.getUint32(0), n: dv.getUint32(4) };
}
function encodeNums(pn: number, n: number): Bytes {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, pn);
  dv.setUint32(4, n);
  return b;
}

// AD constant pentru legarea sesiunii (poate include DID-urile)
export const SESSION_AD = utf8("Cipher/v1");
