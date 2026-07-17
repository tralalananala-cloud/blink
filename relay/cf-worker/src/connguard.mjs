// #5 anti-abuz — throttle de CONEXIUNI/ÎNREGISTRĂRI per IP.
//
// Fiecare DID trăiește pe shardul lui (idFromName("shard:"+DID)), deci un rate-limit
// per-shard NU oprește un atacator care înregistrează multe DID-uri (fiecare = alt shard).
// Limita reală trebuie să fie per-IP, ÎNAINTE de rutarea pe shard. O ținem pe o instanță
// „guard" a aceleiași clase Relay (fără clasă/migrație nouă) și decidem cu token-bucket-ul
// pur (ratelimit.mjs, deja testat).
//
// Reziduu cunoscut: un atacator distribuit (botnet, multe IP-uri) ocolește orice limită
// per-IP — inerent. Scopul e să ridice costul înregistrării în masă de la o sursă, nu să
// promită imposibilul.
import { bucketHit } from "./ratelimit.mjs";

export const CONN_MAX = 60;         // conexiuni/înregistrări acceptate
export const CONN_WINDOW = 60_000;  // pe minut, per IP

/**
 * Decide dacă `ip` a depășit pragul de conexiuni în fereastră. Pur (fără storage/DO):
 * primește istoricul curent, întoarce { limited, hist } cu istoricul re-stocabil.
 */
export function connThrottle(hist, now, max = CONN_MAX, windowMs = CONN_WINDOW) {
  return bucketHit(hist, now, max, windowMs);
}
