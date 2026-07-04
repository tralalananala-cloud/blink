// COADĂ DE LIVRARE AT-LEAST-ONCE (qack) — logică PURĂ, fără DO/socket/storage.
// Rulează identic în Workers și în node → testabilă (vezi test/queue.test.mjs).
//
// Modelul: când destinatarul e offline, mesajul intră în coadă ca { id, env, ts }. La reconectare
// (reg cu ackq) releul RE-LIVREAZĂ coada cu `qid` și o ȘTERGE doar pe măsură ce clientul confirmă
// (qack), după decriptare reușită. Bug-ul reparat (v1.1.5): vechiul cod ștergea coada la reg, ÎNAINTE
// de confirmare → orice eșec în rafală pierdea mesaje definitiv. Aceste funcții codifică fix-ul.

export const MAX_QUEUE = 1000;                 // plafon coadă/destinatar (#5 anti-spam la offline)
export const TTL = 30 * 24 * 3600 * 1000;      // 30 zile — peste asta, mesajul nelivrat expiră

/**
 * Adaugă o intrare în coadă, plafonat la `max` (cele mai vechi cad — anti-flood la offline).
 * Întoarce o coadă NOUĂ (nu mutează intrarea primită).
 */
export function enqueue(q, entry, max = MAX_QUEUE) {
  const out = q.slice();
  while (out.length >= max) out.shift();
  out.push(entry);
  return out;
}

/**
 * Coada de RE-LIVRAT la reg (ackq): păstrează intrările ne-expirate (TTL) și backfill-uiește `id`
 * pt cele vechi (dinainte de qack) ca să fie confirmabile. NU aruncă mesaje neconfirmate — ăsta e
 * miezul at-least-once (regresie v1.1.5: ștergerea cozii la reg pierdea mesaje).
 */
export function pruneFresh(q, now, ttl = TTL, mkId = () => crypto.randomUUID()) {
  return q
    .filter((x) => now - x.ts < ttl)
    .map((x) => (x.id ? x : { ...x, id: mkId() }));
}

/**
 * La qack: scoate din coadă DOAR mesajele confirmate (decriptate+salvate de client); restul rămân
 * pt re-livrare. Idempotent: un `id` necunoscut e ignorat (nu strică restul cozii).
 */
export function removeAcked(q, ids) {
  const ack = new Set(ids);
  return q.filter((x) => !ack.has(x.id));
}
