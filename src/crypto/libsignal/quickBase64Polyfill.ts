/**
 * Polyfill JS pur pentru globalele JSI ale react-native-quick-base64.
 *
 * react-native-quick-base64 (folosit de react-native-libsignal-client + @craftzdog/
 * react-native-buffer) expune `toByteArray`/`fromByteArray`/`btoa`/`atob` care
 * delegă la `global.base64ToArrayBuffer` / `global.base64FromArrayBuffer` — funcții
 * instalate de un modul NATIV (JSI). Dacă modulul nativ nu e prezent, ele sunt
 * undefined → crash ("QuickBase64 could not be found" la varianta TurboModule, sau
 * "undefined is not a function" la folosire).
 *
 * Definind globalele AICI, ÎNAINTE ca quick-base64 să se încarce, eliminăm complet
 * dependența nativă: guard-ul lui (`typeof global.base64FromArrayBuffer !== 'function'`)
 * devine fals → nu mai cheamă `Base64Module.install()`, iar encode/decode folosesc
 * implementarea de mai jos. base64 nu e cale fierbinte aici (doar serializare de
 * chei/mesaje), deci JS pur e suficient.
 *
 * IMPORTĂ ACEST FIȘIER PRIMUL în libsignalEngine.ts (înainte de react-native-libsignal-client).
 */

const STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// Tabel invers char-code → valoare 0..63 (acoperă ambele alfabete: standard + url-safe).
const REV = new Int16Array(128).fill(-1);
for (let i = 0; i < STD.length; i++) REV[STD.charCodeAt(i)] = i;
REV["-".charCodeAt(0)] = 62; // url-safe
REV["_".charCodeAt(0)] = 63; // url-safe

function base64FromArrayBuffer(input: ArrayBuffer, urlSafe = false): string {
  const bytes = new Uint8Array(input);
  const table = urlSafe ? URL : STD;
  const len = bytes.length;
  let out = "";
  let i = 0;
  for (; i + 3 <= len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += table[(n >> 18) & 63] + table[(n >> 12) & 63] + table[(n >> 6) & 63] + table[n & 63];
  }
  const rem = len - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += table[(n >> 18) & 63] + table[(n >> 12) & 63];
    if (!urlSafe) out += "==";
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += table[(n >> 18) & 63] + table[(n >> 12) & 63] + table[(n >> 6) & 63];
    if (!urlSafe) out += "=";
  }
  return out;
}

function base64ToArrayBuffer(b64: string, removeLinebreaks = false): ArrayBuffer {
  let str = b64;
  if (removeLinebreaks) str = str.replace(/[\r\n]/g, "");
  const out = new Uint8Array((str.length * 3) >> 2); // limită superioară
  let p = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    const v = code < 128 ? REV[code] : -1;
    if (v < 0) continue; // sare peste '=', spații, linebreaks, caractere invalide
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (buf >> bits) & 0xff;
    }
  }
  return out.buffer.slice(0, p);
}

const g = globalThis as any;
if (typeof g.base64FromArrayBuffer !== "function") g.base64FromArrayBuffer = base64FromArrayBuffer;
if (typeof g.base64ToArrayBuffer !== "function") g.base64ToArrayBuffer = base64ToArrayBuffer;

export {};
