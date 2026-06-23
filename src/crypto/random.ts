/**
 * Polyfill pentru crypto.getRandomValues în React Native (Hermes nu îl are).
 * Folosește CSPRNG-ul OS-ului prin expo-crypto. @noble/* îl apelează intern.
 * IMPORTANT: importat ÎNAINTE de orice folosire @noble (vezi primitives.ts).
 */
import * as ExpoCrypto from "expo-crypto";

const g: any = globalThis;
if (!g.crypto) g.crypto = {};
if (typeof g.crypto.getRandomValues !== "function") {
  g.crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
    if (array == null) return array;
    return ExpoCrypto.getRandomValues(array as any) as any;
  };
}

export {};
