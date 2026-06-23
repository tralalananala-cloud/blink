/**
 * Generare DID:key + fraza de recuperare.
 *
 * Fraza de recuperare = BIP39 real (2048 cuvinte + checksum) prin @scure/bip39
 * (auditat, din ecosistemul @noble). Entropia vine din CSPRNG-ul lui @noble.
 * `weakRandomHex` rămâne DOAR pt elemente de UI non-critice (nu pt chei).
 */
import { generateMnemonic as bip39Generate, mnemonicToSeedSync, validateMnemonic as bip39Validate } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

const HEX = "0123456789abcdef";

/** DEMO ONLY — NU e CSPRNG. Inlocuit cu expo-crypto in Faza 2. */
export function weakRandomHex(bytes: number): string {
  let out = "";
  for (let i = 0; i < bytes * 2; i++) {
    out += HEX[Math.floor(Math.random() * 16)];
  }
  return out;
}

/** Frază de recuperare BIP39 reală: 12 cuvinte (128 biți entropie + checksum). */
export function generateMnemonic(): string[] {
  return bip39Generate(wordlist, 128).split(" ");
}

/** Normalizează o frază introdusă de utilizator (spații/majuscule). */
function normalizeMnemonic(words: string[] | string): string {
  const m = Array.isArray(words) ? words.join(" ") : words;
  return m.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Validează checksum-ul BIP39 (prinde cuvinte greșite/scrise prost). */
export function validateMnemonic(mnemonic: string): boolean {
  return bip39Validate(normalizeMnemonic(mnemonic), wordlist);
}

/** Derivă seed-ul (32B IKM pt HKDF) determinist din frază — BIP39 PBKDF2. */
export function mnemonicToSeed(words: string[] | string): Uint8Array {
  return mnemonicToSeedSync(normalizeMnemonic(words)).slice(0, 32);
}

/** Construieste un did:key dintr-o cheie publica (forma demo, nu multibase real). */
export function didFromPublicKey(publicKeyHex: string): string {
  const short = publicKeyHex.slice(0, 44);
  return `did:key:z6Mk${short}`;
}

/** Fingerprint citibil de om: grupuri de 4, uppercase. */
export function formatFingerprint(publicKeyHex: string): string {
  const h = publicKeyHex.slice(0, 32).toUpperCase();
  return h.match(/.{1,4}/g)?.join(" ") ?? h;
}
