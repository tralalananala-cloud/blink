/**
 * A1 — teste pe binding-ul de bundle (verifyPeerBundle, PUR, fără modulul nativ):
 *  - lsSig leagă TOT bundle-ul (kyber inclus) de authPub → un „releu" care șterge/alterează
 *    orice câmp e respins;
 *  - fail-closed pe post-quantum: bundle fără kyber → throw (nu cade silențios pe X3DH clasic);
 *  - Decizia #0 A: lsSig lipsă = warn în modul ne-strict, throw în strict (release N+1).
 * Partea nativă (createAndProcessPreKeyBundle) se validează E2E pe device.
 */
jest.mock("expo-crypto", () => ({
  getRandomValues: (arr: any) => require("crypto").webcrypto.getRandomValues(arr),
}));

import { didFromKeys, deriveAuthKey, signNonce, verifyPeerBundle } from "../src/crypto/identity";
import { rand, toB64 } from "../src/crypto/signal/primitives";

/** Fabrică un bundle valid (ls + lsSig) legat corect de peerDid, ca getBundle-ul real. */
function makeBundle(over: Record<string, any> = {}) {
  const idKeyPub = rand(33);                 // cheia publică de identitate (bytes opaci aici)
  const ak = deriveAuthKey(rand(32));        // cheia de auth releu (Ed25519)
  const peerDid = didFromKeys(idKeyPub, ak.pub);
  const obj = {
    regId: 42,
    idKey: toB64(idKeyPub),
    preKeyId: 1, preKey: toB64(rand(33)),
    signedPreKeyId: 1, signedPreKey: toB64(rand(33)), signedPreKeySig: toB64(rand(64)),
    kyberPreKeyId: 1, kyberPreKey: toB64(rand(1568)), kyberPreKeySig: toB64(rand(64)),
    authPub: toB64(ak.pub),
    ...over,
  };
  const ls = JSON.stringify(obj);
  const lsSig = toB64(signNonce(ak.priv, ls));
  return { peerDid, ls, lsSig, ak, idKeyPub, obj };
}

describe("verifyPeerBundle — binding complet al bundle-ului (A1)", () => {
  it("bundle valid → trece", () => {
    const { peerDid, ls, lsSig } = makeBundle();
    expect(() => verifyPeerBundle(peerDid, ls, lsSig, { strict: false })).not.toThrow();
  });

  it("orice câmp `ls` modificat de un releu (signedPreKey) → throw la lsSig", () => {
    const { peerDid, ls, lsSig } = makeBundle();
    const tampered = JSON.parse(ls);
    tampered.signedPreKey = toB64(rand(33)); // releul substituie signed prekey-ul
    const tamperedLs = JSON.stringify(tampered);
    // lsSig-ul vechi nu mai acoperă `ls`-ul modificat → respins
    expect(() => verifyPeerBundle(peerDid, tamperedLs, lsSig, { strict: false }))
      .toThrow(/lsSig/i);
  });

  it("kyber prekey șters (chiar re-semnat de releu) → throw (fail-closed PQXDH)", () => {
    // simulăm un „releu" care are cheia de auth (worst case): șterge kyber ȘI re-semnează
    const { peerDid, obj, ak } = makeBundle();
    delete (obj as any).kyberPreKey;
    delete (obj as any).kyberPreKeySig;
    const ls = JSON.stringify(obj);
    const lsSig = toB64(signNonce(ak.priv, ls)); // semnătură validă, dar fără kyber
    expect(() => verifyPeerBundle(peerDid, ls, lsSig, { strict: false }))
      .toThrow(/kyber|post-quantum|PQXDH/i);
  });

  it("DID nepotrivit (releu substituie cheile) → throw (anti-MITM)", () => {
    const { ls, lsSig } = makeBundle();
    const altDid = didFromKeys(rand(33), rand(32)); // alt DID decât cel din bundle
    expect(() => verifyPeerBundle(altDid, ls, lsSig, { strict: false }))
      .toThrow(/DID|MITM/i);
  });

  it("authPub absent → throw (client incompatibil)", () => {
    const { peerDid, obj, ak } = makeBundle();
    delete (obj as any).authPub;
    const ls = JSON.stringify(obj);
    const lsSig = toB64(signNonce(ak.priv, ls));
    expect(() => verifyPeerBundle(peerDid, ls, lsSig, { strict: false }))
      .toThrow(/authPub/i);
  });

  describe("Decizia #0 A — rollout lsSig", () => {
    it("lsSig lipsă + strict:false → acceptat cu warn (release N)", () => {
      const { peerDid, ls } = makeBundle();
      const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
      expect(() => verifyPeerBundle(peerDid, ls, undefined, { strict: false })).not.toThrow();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it("lsSig lipsă + strict:true → throw (release N+1 impune)", () => {
      const { peerDid, ls } = makeBundle();
      expect(() => verifyPeerBundle(peerDid, ls, undefined, { strict: true }))
        .toThrow(/lsSig/i);
    });
  });
});
