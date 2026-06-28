import { Platform } from "react-native";
import { CryptoEngine, Identity, SerializedBundle, SessionInfo, CipherEnvelope, DecryptResult } from "./types";

/**
 * Punctul unic de injectare a motorului criptografic.
 *
 * Blink rulează pe UN SINGUR motor pe sârmă: **libsignal OFICIAL** (X3DH/PQXDH +
 * Double Ratchet auditat, post-quantum Kyber/ML-KEM, zeroizare nativă). Vechiul
 * SignalEngine pur-JS a fost ȘTERS — era un al doilea format pe sârmă, incompatibil
 * cu libsignal, care ducea la conversații rupte și o cale de re-pair nesigură.
 *
 * Gate pe platformă: libsignal e NATIV (requireNativeModule) → există DOAR pe Android.
 * Pe web/Electron (desktop, momentan parcat în timpul focusului pe Android) întoarcem
 * un stub explicit: aplicația pornește, dar mesageria e dezactivată cu un mesaj clar,
 * în loc să cadă alb sau — mai rău — să folosească tăcut un cifru mai slab.
 */
const USE_LIBSIGNAL = true;

/** Stub web: nu e INSECUR, e INDISPONIBIL. Lasă shell-ul desktop să pornească. */
class UnavailableEngine implements CryptoEngine {
  readonly isSecure = true; // nu folosește criptografie slabă — pur și simplu refuză operațiile
  readonly isAudited = false;
  readonly name = "indisponibil (desktop în migrare pe libsignal)";
  private fail(): never {
    throw new Error("Blink desktop e în migrare pe libsignal — folosește aplicația Android.");
  }
  async generateIdentity(): Promise<Identity> { this.fail(); }
  async loadIdentity(): Promise<Identity | null> { return null; }
  async restoreIdentity(): Promise<Identity> { this.fail(); }
  async exportRecoveryPhrase(): Promise<string[]> { return []; }
  async establishSession(): Promise<SessionInfo> { this.fail(); }
  async getSession(): Promise<SessionInfo | null> { return null; }
  getBundle(): SerializedBundle { this.fail(); }
  async startOutbound(): Promise<SessionInfo> { this.fail(); }
  hasSession(): boolean { return false; }
  async encrypt(): Promise<CipherEnvelope> { this.fail(); }
  async decrypt(): Promise<DecryptResult> { this.fail(); }
  async computeSafetyNumber(): Promise<string> { return ""; }
}

function pickEngine(): CryptoEngine {
  if (USE_LIBSIGNAL && Platform.OS !== "web") {
    // require lazy: libsignalEngine.ts trage modulul nativ Expo (requireNativeModule),
    // care ar arunca la IMPORT pe web/Electron. Așa se evaluează doar pe nativ.
    const { LibsignalEngine } = require("./libsignalEngine") as typeof import("./libsignalEngine");
    return new LibsignalEngine();
  }
  return new UnavailableEngine();
}

export const engine: CryptoEngine = pickEngine();

/** Garda de productie: refuza pornirea cu un motor nesigur intr-un build release. */
export function assertSecureForProduction(): void {
  const isDev = typeof __DEV__ !== "undefined" ? __DEV__ : true;
  if (!isDev && !engine.isSecure) {
    throw new Error(
      "[Blink] Motor criptografic nesigur (" + engine.name + ") intr-un build de productie. Pornire refuzata.",
    );
  }
}

export * from "./types";
