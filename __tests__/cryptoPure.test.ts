/**
 * Faza 1.4 — teste pe miezul cripto PUR extras din libsignalEngine (src/crypto/pure.ts):
 * codec UTF-8, safety number anti-MITM și plicul sealed-sender (#2 metadate + gardă #6 pe `sd`).
 * Partea NATIVĂ (PQXDH/Double Ratchet, ECDH agree, generarea cheilor) NU rulează în jest →
 * se validează E2E pe device; aici acoperim tot ce e octeți-puri și cross-verificabil.
 */
jest.mock("expo-crypto", () => ({
  getRandomValues: (arr: any) => require("crypto").webcrypto.getRandomValues(arr),
}));

import { enc, dec, safetyDigits, sealBox, openBox, readEphPub } from "../src/crypto/pure";
import { genDH, dh, rand, fromB64, equal } from "../src/crypto/signal/primitives";

const DID = "did:key:zABCDEFGHIJKLMNOPQRST"; // 20 base-alfanum după `z` → trece gard #6

describe("enc/dec — codecul UTF-8 al motorului", () => {
  it("roundtrip cu diacritice + emoji", () => {
    const s = "Blink 🔐 ăîâșț — mesaj";
    expect(dec(enc(s))).toBe(s);
  });
  it("șir gol", () => {
    expect(dec(enc(""))).toBe("");
  });
});

describe("safetyDigits — safety number anti-MITM", () => {
  const a = rand(33), b = rand(32);

  it("format: 60 cifre în 12 grupe de 5", () => {
    expect(safetyDigits(a, b)).toMatch(/^(\d{5} ){11}\d{5}$/);
  });
  it("determinist", () => {
    expect(safetyDigits(a, b)).toBe(safetyDigits(a, b));
  });
  it("SIMETRIC — ordinea cheilor nu contează (ambii capeți văd același cod)", () => {
    expect(safetyDigits(a, b)).toBe(safetyDigits(b, a));
  });
  it("sensibil la FIECARE cheie (cheie schimbată → cod diferit = detectează MITM)", () => {
    expect(safetyDigits(a, b)).not.toBe(safetyDigits(rand(33), b));
    expect(safetyDigits(a, b)).not.toBe(safetyDigits(a, rand(32)));
  });
});

describe("sealed-sender box — sigilare/deschidere peste ECDH", () => {
  // simulează ECDH-ul pe care libsignal îl face nativ: cheie efemeră ↔ cheie destinatar.
  function pair() {
    const eph = genDH();         // cheia efemeră a expeditorului
    const rec = genDH();         // cheia de identitate a destinatarului
    const sendShared = dh(eph.priv, rec.pub);  // expeditor: eph.agree(peerPub)
    const recvShared = dh(rec.priv, eph.pub);  // destinatar: myKey.agree(ephPub)
    return { ephPub: eph.pub, sendShared, recvShared, recvWrong: dh(genDH().priv, eph.pub) };
  }
  const payload = { sd: DID, t: 3, c: "bWVzYWo=" };

  it("roundtrip: payload-ul iese identic la celălalt capăt", () => {
    const { ephPub, sendShared, recvShared } = pair();
    const blob = sealBox(sendShared, ephPub, payload);
    expect(openBox(recvShared, blob)).toEqual(payload);
  });

  it("format blob: [ephLen][ephPub][nonce(12)][ct] + readEphPub corect", () => {
    const { ephPub, sendShared } = pair();
    const blob = sealBox(sendShared, ephPub, payload);
    expect(blob[0]).toBe(ephPub.length);
    expect(equal(readEphPub(blob), ephPub)).toBe(true);
    expect(blob.length).toBeGreaterThan(1 + ephPub.length + 12); // antet + nonce + ciphertext
  });

  it("ciphertext modificat → openBox aruncă (AEAD integru)", () => {
    const { ephPub, sendShared, recvShared } = pair();
    const blob = sealBox(sendShared, ephPub, payload);
    blob[blob.length - 1] ^= 0xff; // strică ultimul octet din ct
    expect(() => openBox(recvShared, blob)).toThrow();
  });

  it("secret partajat greșit → openBox aruncă (nu cheia destinatarului)", () => {
    const { ephPub, sendShared, recvWrong } = pair();
    const blob = sealBox(sendShared, ephPub, payload);
    expect(() => openBox(recvWrong, blob)).toThrow();
  });

  it("gardă #6: `sd` malformat → respins înainte de a fi folosit", () => {
    const { ephPub, sendShared, recvShared } = pair();
    const blob = sealBox(sendShared, ephPub, { sd: "nu-i-did", t: 3, c: "x" } as any);
    expect(() => openBox(recvShared, blob)).toThrow(/expeditor.*invalid/);
  });

  it("gardă #6: `sd` lipsă → respins", () => {
    const { ephPub, sendShared, recvShared } = pair();
    const blob = sealBox(sendShared, ephPub, { t: 3, c: "x" } as any);
    expect(() => openBox(recvShared, blob)).toThrow(/expeditor.*invalid/);
  });

  it("nonce-uri diferite la fiecare sigilare (rand) → blob-uri diferite pt același payload", () => {
    const { ephPub, sendShared } = pair();
    const b1 = sealBox(sendShared, ephPub, payload);
    const b2 = sealBox(sendShared, ephPub, payload);
    expect(equal(b1, b2)).toBe(false);
  });
});
