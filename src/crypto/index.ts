import { Platform } from "react-native";
import { SignalEngine } from "./signalEngine";
import { CryptoEngine } from "./types";

/**
 * Punctul unic de injectare a motorului criptografic.
 * - SignalEngine: X3DH + Double Ratchet pur-JS (@noble auditate), isAudited=false.
 * - LibsignalEngine: libsignal OFICIAL nativ (post-quantum/Kyber, auditat, zeroizare).
 *
 * ⚠️ USE_LIBSIGNAL=true schimbă formatul pe sârmă → toți re-pairează (QR) + necesită
 *    build APK (modul nativ Expo, NU merge în Expo Go).
 *
 * Gate pe platformă: libsignal e NATIV → pe web/Electron modulul Expo aruncă la import.
 * De aceea: libsignal DOAR pe nativ (Android), iar desktop/web rămân pe SignalEngine.
 * libsignalEngine se încarcă LAZY (require) ca să nu se evalueze deloc pe web.
 */
const USE_LIBSIGNAL = true;

function pickEngine(): CryptoEngine {
  if (USE_LIBSIGNAL && Platform.OS !== "web") {
    // require lazy: libsignalEngine.ts trage modulul nativ Expo (requireNativeModule),
    // care ar arunca la IMPORT pe web/Electron. Așa se evaluează doar pe nativ.
    const { LibsignalEngine } = require("./libsignalEngine") as typeof import("./libsignalEngine");
    return new LibsignalEngine();
  }
  return new SignalEngine();
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
