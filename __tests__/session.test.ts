/**
 * Teste pe primitivele criptografice partajate (@noble) care rămân după ce
 * SignalEngine pur-JS a fost șters. Motorul real = libsignal NATIV → se testează
 * E2E pe device (modul nativ, nu rulează în jest/node).
 */

// expo-crypto: în node folosim webcrypto pt getRandomValues (polyfill-ul din crypto/random.ts).
jest.mock("expo-crypto", () => ({
  getRandomValues: (arr: any) => require("crypto").webcrypto.getRandomValues(arr),
}));

import {
  utf8, fromUtf8, toB64, fromB64, concat, equal,
  genDH, dh, genSign, sign, verify,
  aeadEncrypt, aeadDecrypt, hkdfBytes, rand,
} from "../src/crypto/signal/primitives";

describe("encodings", () => {
  it("utf8 roundtrip (inclusiv diacritice + emoji)", () => {
    const s = "mesaj secret 🔐 ăîâșț";
    expect(fromUtf8(utf8(s))).toBe(s);
  });
  it("base64 roundtrip pe octeți aleatori", () => {
    const b = rand(48);
    expect(equal(fromB64(toB64(b)), b)).toBe(true);
  });
  it("concat lipește în ordine", () => {
    const out = concat(new Uint8Array([1, 2]), new Uint8Array([3]));
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });
});

describe("X25519 DH", () => {
  it("ambele părți derivă același secret partajat", () => {
    const a = genDH();
    const b = genDH();
    expect(equal(dh(a.priv, b.pub), dh(b.priv, a.pub))).toBe(true);
  });
});

describe("Ed25519 semnături", () => {
  it("verifică o semnătură validă și respinge una falsificată", () => {
    const k = genSign();
    const msg = utf8("prekey");
    const sig = sign(k.priv, msg);
    expect(verify(sig, msg, k.pub)).toBe(true);
    sig[0] ^= 0xff;
    expect(verify(sig, msg, k.pub)).toBe(false);
  });
});

describe("AEAD ChaCha20-Poly1305", () => {
  it("roundtrip cu cheie derivată HKDF", () => {
    const key = hkdfBytes(rand(32), new Uint8Array(0), "test", 32);
    const nonce = rand(12);
    const pt = utf8("integru 🔐");
    const ct = aeadEncrypt(key, nonce, pt, new Uint8Array(0));
    expect(fromUtf8(aeadDecrypt(key, nonce, ct, new Uint8Array(0)))).toBe("integru 🔐");
  });
  it("respinge ciphertext modificat", () => {
    const key = rand(32);
    const nonce = rand(12);
    const ct = aeadEncrypt(key, nonce, utf8("x"), new Uint8Array(0));
    ct[0] ^= 0xff;
    expect(() => aeadDecrypt(key, nonce, ct, new Uint8Array(0))).toThrow();
  });
});
