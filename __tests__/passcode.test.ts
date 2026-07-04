/**
 * Faza 1.5 — parolele de blocare (src/security/passcode.ts). Parola NU se stochează în clar:
 * doar un digest peste salt+pin. Testăm: digest determinist+sărat, scrypt (KDF lent #4) vs SHA-256
 * legacy, comparație în timp constant (#6) și selecția de algoritm după prefix (compat înapoi).
 */
jest.mock("expo-crypto", () => ({
  getRandomValues: (arr: any) => require("crypto").webcrypto.getRandomValues(arr),
}));

import { legacyDigest, scryptDigest, constEq, verifyDigest } from "../src/security/passcode";
import { toB64, rand } from "../src/crypto/signal/primitives";

const salt = toB64(rand(16));
const salt2 = toB64(rand(16));

describe("legacyDigest (SHA-256 + salt)", () => {
  it("determinist", () => {
    expect(legacyDigest(salt, "1234")).toBe(legacyDigest(salt, "1234"));
  });
  it("sărat — salt diferit → digest diferit (anti rainbow-table)", () => {
    expect(legacyDigest(salt, "1234")).not.toBe(legacyDigest(salt2, "1234"));
  });
  it("sensibil la pin", () => {
    expect(legacyDigest(salt, "1234")).not.toBe(legacyDigest(salt, "1235"));
  });
});

describe("scryptDigest (KDF lent #4)", () => {
  it("prefix 's1:' marchează formatul nou", () => {
    expect(scryptDigest(salt, "1234").startsWith("s1:")).toBe(true);
  });
  it("determinist + sensibil la salt și pin", () => {
    expect(scryptDigest(salt, "1234")).toBe(scryptDigest(salt, "1234"));
    expect(scryptDigest(salt, "1234")).not.toBe(scryptDigest(salt2, "1234"));
    expect(scryptDigest(salt, "1234")).not.toBe(scryptDigest(salt, "0000"));
  });
  it("diferit de legacy pe aceeași intrare", () => {
    expect(scryptDigest(salt, "1234")).not.toBe(legacyDigest(salt, "1234"));
  });
});

describe("constEq — comparație în timp constant (#6)", () => {
  it("egal → true, diferit → false, lungimi diferite → false", () => {
    expect(constEq("abc", "abc")).toBe(true);
    expect(constEq("abc", "abd")).toBe(false);
    expect(constEq("abc", "abcd")).toBe(false);
  });
});

describe("verifyDigest — selecție de algoritm după prefix", () => {
  it("digest legacy stocat: pin corect → true, greșit → false", () => {
    const stored = legacyDigest(salt, "secret");
    expect(verifyDigest(salt, "secret", stored)).toBe(true);
    expect(verifyDigest(salt, "gresit", stored)).toBe(false);
  });

  it("digest scrypt stocat: pin corect → true, greșit → false", () => {
    const stored = scryptDigest(salt, "secret");
    expect(verifyDigest(salt, "secret", stored)).toBe(true);
    expect(verifyDigest(salt, "gresit", stored)).toBe(false);
  });

  it("prefixul comută algoritmul — un digest legacy NU e tratat ca scrypt", () => {
    // dacă verifyDigest ar folosi mereu scrypt, un stored legacy n-ar mai valida nicicând
    expect(verifyDigest(salt, "p", legacyDigest(salt, "p"))).toBe(true);
    expect(verifyDigest(salt, "p", scryptDigest(salt, "p"))).toBe(true);
  });
});
