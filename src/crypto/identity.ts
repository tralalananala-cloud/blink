/**
 * Helperi PURI de identitate (fără modulul nativ libsignal) → testabili în jest/node.
 *
 *   DID = "did:key:z6Mk" + base32(sha256(idKey ‖ authPub))[:40]
 *   authKey = Ed25519 derivat determinist din cheia de identitate (HKDF) — cu ea
 *             semnezi challenge-ul releului (C1). Releul verifică semnătura + DID-ul.
 *
 * Aceiași helperi îi folosește LibsignalEngine; izolarea aici îi face verificabili
 * fără să tragem `react-native-libsignal-client` (nativ).
 */
import { Bytes, concat, hash, hkdfBytes, edPubFromPriv, sign, utf8 } from "./signal/primitives";

// base32 RFC4648 (lowercase, fără padding) — alfabet ⊂ [a-z2-7], trece isValidDid.
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export function base32(b: Bytes): string {
  let bits = 0, val = 0, out = "";
  for (let i = 0; i < b.length; i++) {
    val = (val << 8) | b[i]; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

/** DID = commitment criptografic la AMBELE chei publice (identitate + auth releu). */
export function didFromKeys(idPubSer: Bytes, authPub: Bytes): string {
  return "did:key:z6Mk" + base32(hash(concat(idPubSer, authPub))).slice(0, 40);
}

/** Cheia Ed25519 de auth releu, derivată determinist din cheia de identitate (deci din seed). */
export function deriveAuthKey(idKeySer: Bytes): { priv: Bytes; pub: Bytes } {
  const priv = hkdfBytes(idKeySer, new Uint8Array(0), "blink-relay-auth-v1", 32);
  return { priv, pub: edPubFromPriv(priv) };
}

/** Semnează nonce-ul de challenge cu cheia de auth (C1). */
export function signNonce(authPriv: Bytes, nonce: string): Bytes {
  return sign(authPriv, utf8(nonce));
}
