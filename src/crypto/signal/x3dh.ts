/**
 * X3DH — Extended Triple Diffie-Hellman (signal.org/docs/specifications/x3dh).
 * Stabilește cheia secretă inițială (SK) între două părți, asincron.
 * Cheia semnată de prekey (SPK) servește și ca primă cheie de ratchet.
 */
import {
  Bytes,
  concat,
  dh,
  genDH,
  genSign,
  hkdfBytes,
  KeyPair,
  sign,
  verify,
} from "./primitives";

export interface IdentityKeys {
  ik: KeyPair; // X25519, pentru DH
  ed: KeyPair; // Ed25519, pentru semnături
}

/** Ce publică un utilizator pe releu ca alții să-i poată scrie offline. */
export interface PreKeyBundle {
  ikPub: Bytes;
  edPub: Bytes;
  spkPub: Bytes;
  spkSig: Bytes;
  opkPub?: Bytes;
}

/** Privatele pe care le ține destinatarul ca să răspundă la X3DH. */
export interface PreKeySecrets {
  spk: KeyPair;
  opk?: KeyPair;
}

const F = new Uint8Array(32).fill(0xff); // prefix curve25519 conform specificației

export function generateIdentityKeys(): IdentityKeys {
  return { ik: genDH(), ed: genSign() };
}

export function generateBundle(id: IdentityKeys): { bundle: PreKeyBundle; secrets: PreKeySecrets } {
  const spk = genDH();
  const opk = genDH();
  const spkSig = sign(id.ed.priv, spk.pub);
  return {
    bundle: { ikPub: id.ik.pub, edPub: id.ed.pub, spkPub: spk.pub, spkSig, opkPub: opk.pub },
    secrets: { spk, opk },
  };
}

function deriveSK(ikm: Bytes): Bytes {
  return hkdfBytes(concat(F, ikm), new Uint8Array(32), "Cipher_X3DH", 32);
}

/** Inițiatorul (Alice) calculează SK + cheia efemeră publică de trimis. */
export function x3dhInitiator(myId: IdentityKeys, bundle: PreKeyBundle): { sk: Bytes; ekPub: Bytes } {
  if (!verify(bundle.spkSig, bundle.spkPub, bundle.edPub)) {
    throw new Error("X3DH: semnătura prekey-ului semnat e invalidă (posibil MITM)");
  }
  const ek = genDH();
  const dh1 = dh(myId.ik.priv, bundle.spkPub);
  const dh2 = dh(ek.priv, bundle.ikPub);
  const dh3 = dh(ek.priv, bundle.spkPub);
  const parts = [dh1, dh2, dh3];
  if (bundle.opkPub) parts.push(dh(ek.priv, bundle.opkPub));
  return { sk: deriveSK(concat(...parts)), ekPub: ek.pub };
}

/** Destinatarul (Bob) recalculează același SK din cheile lui Alice. */
export function x3dhResponder(
  myId: IdentityKeys,
  secrets: PreKeySecrets,
  aliceIkPub: Bytes,
  aliceEkPub: Bytes,
): Bytes {
  const dh1 = dh(secrets.spk.priv, aliceIkPub);
  const dh2 = dh(myId.ik.priv, aliceEkPub);
  const dh3 = dh(secrets.spk.priv, aliceEkPub);
  const parts = [dh1, dh2, dh3];
  if (secrets.opk) parts.push(dh(secrets.opk.priv, aliceEkPub));
  return deriveSK(concat(...parts));
}

/** Cheia de ratchet inițială a lui Bob = signed prekey-ul lui. */
export function bobRatchetKey(secrets: PreKeySecrets): KeyPair {
  return secrets.spk;
}
