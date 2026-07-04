/**
 * Faza 1.5 — cripto la-repaus a valorilor KV (src/storage/valueCrypto.ts).
 * Mesajele/sesiunile/starea trăiesc pe disc DOAR criptate (ChaCha20-Poly1305, cheie în Keystore).
 * Aici testăm round-trip-ul pur: cheie greșită / octeți stricați → eșec CURAT (AEAD aruncă).
 */
jest.mock("expo-crypto", () => ({
  getRandomValues: (arr: any) => require("crypto").webcrypto.getRandomValues(arr),
}));

import { sealValue, openValue, strToBytes, bytesToStr } from "../src/storage/valueCrypto";
import { rand, fromB64, equal } from "../src/crypto/signal/primitives";

describe("strToBytes / bytesToStr", () => {
  it("roundtrip cu emoji + diacritice (surrogate pairs)", () => {
    const s = "stare 🔐 ăîâșț 𝄞";
    expect(bytesToStr(strToBytes(s))).toBe(s);
  });
});

describe("sealValue / openValue — AEAD la repaus", () => {
  const key = rand(32);

  it("roundtrip: valoarea iese identică cu aceeași cheie", () => {
    const v = "mesaj secret 🔐 ăîâ";
    expect(openValue(key, sealValue(key, v))).toBe(v);
  });

  it("șir gol roundtrip", () => {
    expect(openValue(key, sealValue(key, ""))).toBe("");
  });

  it("cheie GREȘITĂ → openValue aruncă (eșec curat, nu date corupte)", () => {
    const sealed = sealValue(key, "confidential");
    expect(() => openValue(rand(32), sealed)).toThrow();
  });

  it("ciphertext modificat → openValue aruncă (integritate AEAD)", () => {
    const blob = fromB64(sealValue(key, "integru"));
    blob[blob.length - 1] ^= 0xff;
    const tampered = Buffer.from(blob).toString("base64");
    expect(() => openValue(key, tampered)).toThrow();
  });

  it("nonce aleator → același text dă blob-uri diferite (fără leak de egalitate)", () => {
    const a = fromB64(sealValue(key, "la fel"));
    const b = fromB64(sealValue(key, "la fel"));
    expect(equal(a, b)).toBe(false);
  });

  it("format: nonce(12) + ciphertext cu tag(16) → cel puțin 12+16 octeți", () => {
    const blob = fromB64(sealValue(key, "x"));
    expect(blob.length).toBeGreaterThanOrEqual(12 + 16);
  });
});
