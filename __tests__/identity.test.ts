/**
 * Teste de regresie pe codul de securitate NOU (auditul 2026-06): identitate legată de chei,
 * derivarea cheii de auth releu, și contractul de auth C1 (semnătura clientului trebuie să
 * treacă verificarea releului — @noble sign ↔ WebCrypto Ed25519 verify).
 */
jest.mock("expo-crypto", () => ({
  getRandomValues: (arr: any) => require("crypto").webcrypto.getRandomValues(arr),
}));

import { base32, didFromKeys, deriveAuthKey, signNonce } from "../src/crypto/identity";
import { rand, toB64 } from "../src/crypto/signal/primitives";

const { webcrypto } = require("crypto");
const subtle = webcrypto.subtle;

/** Replică EXACT verificarea releului (cf-worker verifyReg): did === didFromKeys + sig Ed25519. */
async function relayVerify(did: string, idKey: Uint8Array, authPub: Uint8Array, sig: Uint8Array, nonce: string) {
  if (didFromKeys(idKey, authPub) !== did) return false;
  const key = await subtle.importKey("raw", authPub, { name: "Ed25519" }, false, ["verify"]);
  return subtle.verify({ name: "Ed25519" }, key, sig, new TextEncoder().encode(nonce));
}

describe("base32", () => {
  it("doar alfabet [a-z2-7]", () => {
    expect(/^[a-z2-7]*$/.test(base32(rand(32)))).toBe(true);
  });
  it("determinist + lungime corectă pt 32B (ceil(256/5)=52)", () => {
    const b = rand(32);
    expect(base32(b)).toBe(base32(b));
    expect(base32(b).length).toBe(52);
  });
});

describe("didFromKeys — DID = hash al ambelor chei (#3)", () => {
  it("format did:key:z6Mk + 40 base32", () => {
    expect(didFromKeys(rand(33), rand(32))).toMatch(/^did:key:z6Mk[a-z2-7]{40}$/);
  });
  it("determinist și sensibil la FIECARE cheie (non-lossy)", () => {
    const idk = rand(33), auth = rand(32);
    expect(didFromKeys(idk, auth)).toBe(didFromKeys(idk, auth));
    expect(didFromKeys(idk, auth)).not.toBe(didFromKeys(rand(33), auth));
    expect(didFromKeys(idk, auth)).not.toBe(didFromKeys(idk, rand(32)));
  });
});

describe("deriveAuthKey — cheia de auth, deterministă din identitate", () => {
  it("același idKey → același authPub; idKey diferit → diferit", () => {
    const idk = rand(32);
    expect(toB64(deriveAuthKey(idk).pub)).toBe(toB64(deriveAuthKey(idk).pub));
    expect(toB64(deriveAuthKey(idk).pub)).not.toBe(toB64(deriveAuthKey(rand(32)).pub));
  });
});

describe("C1 auth: semnătura clientului ↔ verificarea releului", () => {
  it("reg valid trece verificarea releului", async () => {
    const idKey = rand(33);
    const ak = deriveAuthKey(idKey);
    const did = didFromKeys(idKey, ak.pub);
    const nonce = "challenge-abc";
    const sig = signNonce(ak.priv, nonce);
    expect(await relayVerify(did, idKey, ak.pub, sig, nonce)).toBe(true);
  });

  it("nonce greșit → respins (anti-replay de challenge)", async () => {
    const idKey = rand(33);
    const ak = deriveAuthKey(idKey);
    const did = didFromKeys(idKey, ak.pub);
    const sig = signNonce(ak.priv, "nonce-A");
    expect(await relayVerify(did, idKey, ak.pub, sig, "nonce-B")).toBe(false);
  });

  it("DID-HIJACK: idKey-ul victimei + authPub-ul atacatorului → DID nu se potrivește → respins (C1/C2)", async () => {
    const victimIdKey = rand(33);
    const victimAk = deriveAuthKey(rand(32));
    const victimDid = didFromKeys(victimIdKey, victimAk.pub);
    // atacatorul cunoaște idKey-ul public al victimei + DID-ul, dar are propria cheie de auth
    const attackerAk = deriveAuthKey(rand(32));
    const sig = signNonce(attackerAk.priv, "n");
    expect(await relayVerify(victimDid, victimIdKey, attackerAk.pub, sig, "n")).toBe(false);
  });
});
