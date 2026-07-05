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
import { Bytes, concat, hash, hkdfBytes, edPubFromPriv, sign, verify, utf8, fromB64 } from "./signal/primitives";

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

/**
 * A1 — verifică binding-ul COMPLET al unui bundle de peer înainte de a stabili o sesiune.
 * PUR (fără modulul nativ) → testabil în jest. Verifică, în ordine (fail-closed la orice pas):
 *   (a) authPub prezent;
 *   (b) DID = didFromKeys(idKey, authPub) === peerDid (anti-MITM releu, C2);
 *   (c) lsSig valid peste string-ul `ls` exact — leagă TOT bundle-ul (kyber inclus) de authPub;
 *       dacă lipsește: throw în modul `strict` (release N+1), altfel doar warn (Decizia #0 A);
 *   (d) kyberPreKey prezent → PQXDH obligatoriu (fail-closed pe post-quantum, impus din N).
 * Aruncă la orice nepotrivire; nu întoarce nimic (efect = „e sigur să continui").
 */
export function verifyPeerBundle(
  peerDid: string, ls: string, lsSig: string | undefined, opts: { strict: boolean },
): void {
  const b = JSON.parse(ls);
  if (!b.authPub) throw new Error("Bundle fără authPub (client incompatibil) — re-pair necesar");
  if (didFromKeys(fromB64(b.idKey), fromB64(b.authPub)) !== peerDid) {
    throw new Error("Bundle: cheile nu corespund DID-ului scanat (posibil MITM releu)");
  }
  if (lsSig) {
    if (!verify(fromB64(lsSig), utf8(ls), fromB64(b.authPub))) {
      throw new Error("Bundle: semnătură lsSig invalidă (posibil releu compromis)");
    }
  } else if (opts.strict) {
    throw new Error("Bundle fără lsSig — impus (release N+1)");
  } else {
    console.warn("[Blink] bundle fără lsSig — acceptat temporar (Decizia #0 A); impus în N+1");
  }
  if (!b.kyberPreKey) {
    throw new Error("Bundle fără kyber prekey — PQXDH obligatoriu (fail-closed pe post-quantum)");
  }
}

/**
 * A2 — verifică că DID-ul revendicat de un plic sealed (`sd`) derivă din cheia de identitate
 * REALĂ a expeditorului (citită din idStore DUPĂ decriptare, fiindcă `PreKeySignalMessage` nu
 * expune identityKey înainte) + authPub-ul din plic (`ap`). PUR → testabil în jest.
 * Blochează otrăvirea identity-store: un atacator care pune `sd = DID-ul victimei` dar semnează
 * mesajul cu cheia LUI e prins — didFromKeys(cheia lui, ap) ≠ DID-ul victimei (ar avea nevoie de
 * cheia privată a victimei ca să potrivească). Aruncă la nepotrivire (apelantul face rollback).
 */
export function verifySealedSender(realIdKeySer: Bytes, ap: Bytes, claimedDid: string): void {
  if (didFromKeys(realIdKeySer, ap) !== claimedDid) {
    throw new Error("Plic sealed: DID revendicat nu corespunde cheii reale (impersonare) — respins");
  }
}
