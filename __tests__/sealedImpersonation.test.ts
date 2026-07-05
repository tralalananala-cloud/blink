/**
 * A2 — teste pe garda anti-impersonare a plicului sealed (verifySealedSender, PUR).
 * Scenariul de atac: un plic PreKey sealed cu `sd = DID-ul victimei` dar semnat cu cheia
 * atacatorului → ar otrăvi identity-store-ul sub DID-ul victimei. Garda leagă `sd` de cheia
 * de identitate REALĂ (citită după decriptare) + `ap` din plic → atacatorul e prins.
 * Rollback-ul efectiv al store-ului (identitate+sesiune) se validează E2E pe device.
 */
jest.mock("expo-crypto", () => ({
  getRandomValues: (arr: any) => require("crypto").webcrypto.getRandomValues(arr),
}));

import { didFromKeys, deriveAuthKey, verifySealedSender } from "../src/crypto/identity";
import { rand } from "../src/crypto/signal/primitives";

describe("verifySealedSender — anti-impersonare TOFU sealed (A2)", () => {
  it("plic legit (sd derivă din cheia reală + ap) → trece", () => {
    const idKey = rand(33);
    const ak = deriveAuthKey(rand(32));
    const sd = didFromKeys(idKey, ak.pub);
    expect(() => verifySealedSender(idKey, ak.pub, sd)).not.toThrow();
  });

  it("sd forjat = DID-ul victimei, dar cheia reală e a atacatorului → throw", () => {
    // victima
    const victimIdKey = rand(33);
    const victimAk = deriveAuthKey(rand(32));
    const victimDid = didFromKeys(victimIdKey, victimAk.pub);
    // atacatorul: cheia lui reală (din mesajul PreKey decriptat) + orice ap pune el în plic
    const attackerIdKey = rand(33);
    const attackerAp = deriveAuthKey(rand(32)).pub;
    expect(() => verifySealedSender(attackerIdKey, attackerAp, victimDid))
      .toThrow(/impersonare|respins/i);
  });

  it("atacatorul pune ap = authPub-ul PUBLIC al victimei, dar cheia reală rămâne a lui → throw", () => {
    const victimIdKey = rand(33);
    const victimAk = deriveAuthKey(rand(32));
    const victimDid = didFromKeys(victimIdKey, victimAk.pub);
    const attackerIdKey = rand(33); // ≠ victimIdKey (n-are cheia privată a victimei)
    // chiar cu ap = victimAuthPub (public, cunoscut), didFrom(cheia atacatorului, victimAuthPub) ≠ victimDid
    expect(() => verifySealedSender(attackerIdKey, victimAk.pub, victimDid))
      .toThrow(/impersonare|respins/i);
  });

  it("sensibil la ap: cheia reală corectă dar ap greșit → throw (sd nu se mai potrivește)", () => {
    const idKey = rand(33);
    const realAk = deriveAuthKey(rand(32));
    const sd = didFromKeys(idKey, realAk.pub);
    const wrongAp = deriveAuthKey(rand(32)).pub;
    expect(() => verifySealedSender(idKey, wrongAp, sd)).toThrow(/impersonare|respins/i);
  });
});
