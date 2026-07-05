// #B1 — teste pe token-bucket-ul pur folosit de rate-limit-ul pe getbundle (anti-drenare OPK).
// Rulează în node (`npm test` în cf-worker). Verifică: primele N treceri, apoi `limited`, +
// recuperare după fereastră, + izolare per cheie (per DID).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketHit } from "../src/ratelimit.mjs";

test("primele MAX treceri, apoi limitat", () => {
  const MAX = 30, W = 3_600_000, now = 1_000_000;
  let hist;
  for (let i = 0; i < MAX; i++) {
    const r = bucketHit(hist, now, MAX, W);
    assert.equal(r.limited, false, `hit ${i} ar trebui permis`);
    hist = r.hist;
  }
  const over = bucketHit(hist, now, MAX, W);
  assert.equal(over.limited, true, "al MAX+1-lea POP e blocat");
  assert.equal(over.hist.length, MAX, "peste prag nu mai adaugă hit-uri");
});

test("recuperare după fereastră (intrările vechi expiră)", () => {
  const MAX = 3, W = 1000;
  let hist;
  for (let i = 0; i < MAX; i++) hist = bucketHit(hist, 0, MAX, W).hist;
  assert.equal(bucketHit(hist, 500, MAX, W).limited, true, "încă în fereastră → blocat");
  // după fereastră: toate cele 3 au expirat → din nou permis
  const after = bucketHit(hist, 1500, MAX, W);
  assert.equal(after.limited, false, "după fereastră → permis din nou");
});

test("izolare per cheie (map separat per DID)", () => {
  const MAX = 2, W = 1000, now = 5000;
  const m = new Map();
  const hit = (did) => { const r = bucketHit(m.get(did), now, MAX, W); m.set(did, r.hist); return r.limited; };
  assert.equal(hit("did:A"), false);
  assert.equal(hit("did:A"), false);
  assert.equal(hit("did:A"), true, "A a atins pragul");
  assert.equal(hit("did:B"), false, "B are propriul bucket, neafectat de A");
});
