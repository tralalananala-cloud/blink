// Faza 1.3 — teste pe COADA de livrare at-least-once (importă codul REAL din src/queue.mjs).
// Rulează în node (`npm test` în cf-worker). Releul nu trebuie să PIARDĂ mesaje offline:
// coada se șterge DOAR pe măsură ce clientul confirmă (qack), nu la reconectare (reg).
import { test } from "node:test";
import assert from "node:assert/strict";
import { enqueue, pruneFresh, removeAcked, MAX_QUEUE, TTL } from "../src/queue.mjs";

const E = (id, ts = Date.now(), env = { c: id }) => ({ id, env, ts }); // intrare de coadă

test("enqueue: adaugă la coadă fără să mute restul", () => {
  const q = [E("a"), E("b")];
  const q2 = enqueue(q, E("c"));
  assert.deepEqual(q2.map((x) => x.id), ["a", "b", "c"]);
  assert.equal(q.length, 2, "intrarea originală nu se mută");
});

test("enqueue: plafonat la max — cele mai vechi cad (#5 anti-flood)", () => {
  let q = [];
  for (let i = 0; i < 5; i++) q = enqueue(q, E("m" + i), 3);
  assert.equal(q.length, 3);
  assert.deepEqual(q.map((x) => x.id), ["m2", "m3", "m4"]); // m0/m1 au căzut
});

test("enqueue: la fix max, face loc exact pt unul nou", () => {
  const full = Array.from({ length: MAX_QUEUE }, (_, i) => E("x" + i));
  const q2 = enqueue(full, E("nou"));
  assert.equal(q2.length, MAX_QUEUE);
  assert.equal(q2[q2.length - 1].id, "nou");
  assert.equal(q2[0].id, "x1"); // x0 a căzut
});

test("REGRESIE v1.1.5 — reg (pruneFresh) NU șterge coada neconfirmată", () => {
  // bug-ul vechi: reg ștergea toată coada înainte de confirmare → mesaje pierdute în rafală.
  const now = 1_000_000_000_000;
  const q = [E("a", now - 1000), E("b", now - 2000), E("c", now - 3000)];
  const fresh = pruneFresh(q, now);
  assert.deepEqual(fresh.map((x) => x.id), ["a", "b", "c"], "toate mesajele ne-expirate supraviețuiesc reg-ului");
});

test("pruneFresh: aruncă DOAR intrările expirate (peste TTL)", () => {
  const now = 1_000_000_000_000;
  const q = [E("vechi", now - TTL - 1), E("proaspat", now - 1000)];
  const fresh = pruneFresh(q, now);
  assert.deepEqual(fresh.map((x) => x.id), ["proaspat"]);
});

test("pruneFresh: backfill id pt intrările legacy (dinainte de qack)", () => {
  const now = 1_000_000_000_000;
  let n = 0;
  const mkId = () => "gen" + n++;
  const q = [{ env: { c: 1 }, ts: now - 1000 }, E("are-id", now - 500)];
  const fresh = pruneFresh(q, now, TTL, mkId);
  assert.equal(fresh[0].id, "gen0", "intrarea fără id primește unul → confirmabilă");
  assert.equal(fresh[1].id, "are-id", "id-ul existent rămâne neschimbat");
});

test("removeAcked: scoate DOAR id-urile confirmate; restul rămân pt re-livrare", () => {
  const q = [E("a"), E("b"), E("c")];
  const left = removeAcked(q, ["b"]);
  assert.deepEqual(left.map((x) => x.id), ["a", "c"]);
});

test("removeAcked: idempotent — id necunoscut nu strică restul cozii", () => {
  const q = [E("a"), E("b")];
  assert.deepEqual(removeAcked(q, ["necunoscut"]).map((x) => x.id), ["a", "b"]);
  assert.deepEqual(removeAcked(q, []).map((x) => x.id), ["a", "b"]);
});

test("removeAcked: confirmarea tuturor golește coada", () => {
  const q = [E("a"), E("b")];
  assert.equal(removeAcked(q, ["a", "b"]).length, 0);
});

test("ciclu complet: enqueue → reg păstrează → qack parțial → re-livrare doar restul", () => {
  const now = 2_000_000_000_000;
  // 3 mesaje sosesc cât peer-ul e offline
  let q = [];
  q = enqueue(q, E("m1", now - 30));
  q = enqueue(q, E("m2", now - 20));
  q = enqueue(q, E("m3", now - 10));
  // reconectare: reg re-livrează toate (nimic pierdut)
  const delivered = pruneFresh(q, now);
  assert.deepEqual(delivered.map((x) => x.id), ["m1", "m2", "m3"]);
  // clientul decriptează+salvează m1 și m2, dar m3 eșuează (rafală) → confirmă doar m1,m2
  q = removeAcked(q, ["m1", "m2"]);
  // următoarea reconectare: m3 se re-livrează (nu s-a pierdut)
  assert.deepEqual(pruneFresh(q, now).map((x) => x.id), ["m3"]);
});
