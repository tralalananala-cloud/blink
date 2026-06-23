/**
 * Teste pe criptografia REALĂ (X3DH + Double Ratchet, SignalEngine).
 * Două nivele:
 *  1. protocol direct, două părți (Alice↔Bob), inclusiv mesaje out-of-order;
 *  2. contractul CryptoEngine prin SignalEngine.
 */

// expo-secure-store nu există în node -> mock in-memory.
jest.mock("expo-secure-store", () => {
  const mem: Record<string, string> = {};
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "x",
    setItemAsync: async (k: string, v: string) => { mem[k] = v; },
    getItemAsync: async (k: string) => mem[k] ?? null,
    deleteItemAsync: async (k: string) => { delete mem[k]; },
  };
});
// expo-crypto: în node folosim webcrypto pt getRandomValues.
jest.mock("expo-crypto", () => ({
  getRandomValues: (arr: any) => require("crypto").webcrypto.getRandomValues(arr),
}));

import { utf8, fromUtf8 } from "../src/crypto/signal/primitives";
import {
  generateIdentityKeys,
  generateBundle,
  x3dhInitiator,
  x3dhResponder,
} from "../src/crypto/signal/x3dh";
import {
  initAlice,
  initBob,
  ratchetDecrypt,
  ratchetEncrypt,
} from "../src/crypto/signal/doubleRatchet";
import { SignalEngine } from "../src/crypto/signalEngine";

const AD = utf8("test-ad");

function handshake() {
  const alice = generateIdentityKeys();
  const bob = generateIdentityKeys();
  const { bundle, secrets } = generateBundle(bob);
  const { sk, ekPub } = x3dhInitiator(alice, bundle);
  const skBob = x3dhResponder(bob, secrets, alice.ik.pub, ekPub);
  return {
    aliceRatchet: initAlice(sk, bundle.spkPub),
    bobRatchet: initBob(skBob, secrets.spk),
  };
}

describe("X3DH", () => {
  it("ambele părți derivă ACEEAȘI cheie secretă", () => {
    const alice = generateIdentityKeys();
    const bob = generateIdentityKeys();
    const { bundle, secrets } = generateBundle(bob);
    const { sk, ekPub } = x3dhInitiator(alice, bundle);
    const skBob = x3dhResponder(bob, secrets, alice.ik.pub, ekPub);
    expect(Buffer.from(sk).toString("hex")).toBe(Buffer.from(skBob).toString("hex"));
  });

  it("respinge un bundle cu semnătură de prekey falsificată (anti-MITM)", () => {
    const alice = generateIdentityKeys();
    const bob = generateIdentityKeys();
    const { bundle } = generateBundle(bob);
    bundle.spkSig[0] ^= 0xff; // stricăm semnătura
    expect(() => x3dhInitiator(alice, bundle)).toThrow();
  });
});

describe("Double Ratchet", () => {
  it("roundtrip Alice -> Bob", () => {
    const { aliceRatchet, bobRatchet } = handshake();
    const msg = "mesaj secret 🔐 ăîâ";
    const { header, ct } = ratchetEncrypt(aliceRatchet, utf8(msg), AD);
    const pt = ratchetDecrypt(bobRatchet, header, ct, AD);
    expect(fromUtf8(pt)).toBe(msg);
  });

  it("conversație bidirecțională (DH ratchet în ambele sensuri)", () => {
    const { aliceRatchet, bobRatchet } = handshake();
    const m1 = ratchetEncrypt(aliceRatchet, utf8("salut Bob"), AD);
    expect(fromUtf8(ratchetDecrypt(bobRatchet, m1.header, m1.ct, AD))).toBe("salut Bob");
    const r1 = ratchetEncrypt(bobRatchet, utf8("salut Alice"), AD);
    expect(fromUtf8(ratchetDecrypt(aliceRatchet, r1.header, r1.ct, AD))).toBe("salut Alice");
  });

  it("forward secrecy: același text -> ciphertext diferit la fiecare mesaj", () => {
    const { aliceRatchet } = handshake();
    const a = ratchetEncrypt(aliceRatchet, utf8("la fel"), AD);
    const b = ratchetEncrypt(aliceRatchet, utf8("la fel"), AD);
    expect(Buffer.from(a.ct).toString("hex")).not.toBe(Buffer.from(b.ct).toString("hex"));
  });

  it("mesaje out-of-order (skipped keys): decriptează m3 înainte de m2", () => {
    const { aliceRatchet, bobRatchet } = handshake();
    const m1 = ratchetEncrypt(aliceRatchet, utf8("unu"), AD);
    const m2 = ratchetEncrypt(aliceRatchet, utf8("doi"), AD);
    const m3 = ratchetEncrypt(aliceRatchet, utf8("trei"), AD);
    expect(fromUtf8(ratchetDecrypt(bobRatchet, m1.header, m1.ct, AD))).toBe("unu");
    expect(fromUtf8(ratchetDecrypt(bobRatchet, m3.header, m3.ct, AD))).toBe("trei");
    expect(fromUtf8(ratchetDecrypt(bobRatchet, m2.header, m2.ct, AD))).toBe("doi");
  });

  it("respinge ciphertext modificat (AEAD)", () => {
    const { aliceRatchet, bobRatchet } = handshake();
    const m = ratchetEncrypt(aliceRatchet, utf8("integru"), AD);
    m.ct[0] ^= 0xff;
    expect(() => ratchetDecrypt(bobRatchet, m.header, m.ct, AD)).toThrow();
  });
});

describe("SignalEngine (contract)", () => {
  it("generează identitate reală cu DID + fingerprint", async () => {
    const e = new SignalEngine();
    const id = await e.generateIdentity();
    expect(id.did).toMatch(/^did:key:/);
    expect(id.fingerprint).toMatch(/[0-9A-F]{4}/);
  });

  it("două dispozitive reale schimbă mesaje E2E prin bundle + X3DH", async () => {
    const alice = new SignalEngine();
    const bob = new SignalEngine();
    const aliceId = await alice.generateIdentity();
    const bobId = await bob.generateIdentity();

    // Alice ia bundle-ul lui Bob și inițiază (X3DH)
    await alice.startOutbound(bobId.did, bob.getBundle());
    const env1 = await alice.encrypt(bobId.did, "salut Bob");
    expect(env1.fromDid).toBe(aliceId.did);
    expect(env1.prekey).toBeTruthy(); // primul mesaj = prekey message
    // Bob completează X3DH la primire
    expect((await bob.decrypt(env1)).plaintext).toBe("salut Bob");

    // Bob răspunde (DH ratchet în ambele sensuri)
    const env2 = await bob.encrypt(aliceId.did, "salut Alice");
    expect((await alice.decrypt(env2)).plaintext).toBe("salut Alice");
  });

  it("un al treilea dispozitiv NU poate decripta plicul", async () => {
    const alice = new SignalEngine();
    const bob = new SignalEngine();
    const eve = new SignalEngine();
    await alice.generateIdentity();
    const bobId = await bob.generateIdentity();
    await eve.generateIdentity();
    await alice.startOutbound(bobId.did, bob.getBundle());
    const env = await alice.encrypt(bobId.did, "doar pentru Bob");
    await expect(eve.decrypt(env)).rejects.toBeTruthy();
  });

  it("re-pairing: după ce un peer își resetează identitatea, celălalt se auto-vindecă din prekey (B2/B4)", async () => {
    const alice = new SignalEngine();
    const bob = new SignalEngine();
    const aliceId = await alice.generateIdentity();
    const bobId = await bob.generateIdentity();

    // sesiune inițială + schimb bidirecțional (ambii au sesiune)
    await alice.startOutbound(bobId.did, bob.getBundle());
    await bob.decrypt(await alice.encrypt(bobId.did, "salut"));
    await alice.decrypt(await bob.encrypt(aliceId.did, "salut și ție"));

    // Alice se „restaurează/resetează": pierde sesiunea ratchet (identitatea rămâne)
    alice.resetSession(bobId.did);

    // Alice re-pairează prin QR → re-stabilește X3DH → mesajul nou poartă prekey
    await alice.startOutbound(bobId.did, bob.getBundle());
    const reNew = await alice.encrypt(bobId.did, "m-am restaurat");
    expect(reNew.prekey).toBeTruthy();

    // Bob ÎNCĂ are sesiunea VECHE → trebuie să se auto-vindece din prekey (nu eșec silențios)
    expect((await bob.decrypt(reNew)).plaintext).toBe("m-am restaurat");
    // conversația continuă în ambele sensuri pe sesiunea nouă
    expect((await alice.decrypt(await bob.encrypt(aliceId.did, "bine ai revenit"))).plaintext).toBe("bine ai revenit");
  });

  it("se declară REAL dar NEAUDITAT (libsignal oficial vine în Faza 2b)", () => {
    const e = new SignalEngine();
    expect(e.isSecure).toBe(true);
    expect(e.isAudited).toBe(false);
  });
});
