/**
 * D2 — umple golul de test „sealed sender (encrypt/decrypt round-trip)" din audit, la nivelul
 * PUR (framing + AEAD box peste ECDH), INCLUSIV câmpul nou `ap` (A2). Partea nativă
 * (signalEncrypt/Decrypt care produce mesajul libsignal din interior) rămâne E2E pe device.
 *
 * Celelalte două goluri numite de audit:
 *  - binding DID la `startOutbound` → acoperit de __tests__/bundleBinding.test.ts (verifyPeerBundle);
 *  - Double Ratchet multi-mesaj → e în libsignal NATIV (nu rulează în jest) → acoperit E2E
 *    (text bidirecțional repetat) + ordonarea/at-least-once la transport în relay.wire.test.ts.
 */
jest.mock("expo-crypto", () => ({
  getRandomValues: (arr: any) => require("crypto").webcrypto.getRandomValues(arr),
}));

import { sealBox, openBox, readEphPub } from "../src/crypto/pure";
import { genDH, dh } from "../src/crypto/signal/primitives";

const DID_A = "did:key:z6MkSenderAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const AP_A = "YXV0aFB1YkJhc2U2NEV4YW1wbGVGb3JUZXN0aW5nAAAA"; // authPub b64 (opac aici)

/** Reproduce ECDH-ul nativ (eph.agree(peerPub) / myKey.agree(ephPub)) cu X25519 din @noble. */
function channel() {
  const eph = genDH();  // cheia efemeră a expeditorului
  const rec = genDH();  // cheia de identitate a destinatarului
  return {
    ephPub: eph.pub,
    sendShared: dh(eph.priv, rec.pub),
    recvShared: dh(rec.priv, eph.pub),
    recvWrong: dh(genDH().priv, eph.pub), // secret al altcuiva
  };
}

describe("D2 — plic sealed sender: round-trip cu authPub (ap)", () => {
  it("payload {sd, ap, t, c} supraviețuiește intact (ap adăugat de A2)", () => {
    const { ephPub, sendShared, recvShared } = channel();
    const payload = { sd: DID_A, ap: AP_A, t: 3, c: "bWVzYWpsaWJzaWduYWw=" };
    const blob = sealBox(sendShared, ephPub, payload);
    expect(openBox(recvShared, blob)).toEqual(payload); // sd, ap, t, c toate păstrate
  });

  it("compat înapoi: plic FĂRĂ ap (expeditor vechi) se deschide, ap = undefined", () => {
    const { ephPub, sendShared, recvShared } = channel();
    const payload = { sd: DID_A, t: 3, c: "Yw==" };
    const out = openBox(recvShared, blobOf(sendShared, ephPub, payload));
    expect(out.sd).toBe(DID_A);
    expect(out.ap).toBeUndefined();
  });

  it("ephPub din antet e citibil pentru calculul shared (readEphPub)", () => {
    const { ephPub, sendShared } = channel();
    const blob = sealBox(sendShared, ephPub, { sd: DID_A, ap: AP_A, t: 3, c: "Yw==" });
    expect(Buffer.from(readEphPub(blob)).equals(Buffer.from(ephPub))).toBe(true);
  });

  it("secret ECDH greșit (alt destinatar) → AEAD respinge", () => {
    const { ephPub, sendShared, recvWrong } = channel();
    const blob = sealBox(sendShared, ephPub, { sd: DID_A, ap: AP_A, t: 3, c: "Yw==" });
    expect(() => openBox(recvWrong, blob)).toThrow();
  });

  it("octet modificat în ciphertext → AEAD respinge (integritate)", () => {
    const { ephPub, sendShared, recvShared } = channel();
    const blob = sealBox(sendShared, ephPub, { sd: DID_A, ap: AP_A, t: 3, c: "Yw==" });
    blob[blob.length - 1] ^= 0x01;
    expect(() => openBox(recvShared, blob)).toThrow();
  });

  it("gardă #6: `sd` malformat → respins chiar dacă AEAD trece", () => {
    const { ephPub, sendShared, recvShared } = channel();
    const blob = sealBox(sendShared, ephPub, { sd: "not-a-did", ap: AP_A, t: 3, c: "Yw==" });
    expect(() => openBox(recvShared, blob)).toThrow(/sd|expeditor/i);
  });
});

function blobOf(shared: Uint8Array, ephPub: Uint8Array, payload: any) {
  return sealBox(shared, ephPub, payload);
}
