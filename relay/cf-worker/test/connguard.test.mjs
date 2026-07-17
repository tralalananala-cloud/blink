import test from "node:test";
import assert from "node:assert/strict";
import { connThrottle, CONN_MAX, CONN_WINDOW } from "../src/connguard.mjs";

test("permite până la CONN_MAX conexiuni în fereastră, apoi limitează", () => {
  const now = 1_000_000;
  let hist;
  for (let i = 0; i < CONN_MAX; i++) {
    const r = connThrottle(hist, now);
    assert.equal(r.limited, false, `conexiunea ${i + 1} ar trebui permisă`);
    hist = r.hist;
  }
  // a (CONN_MAX+1)-a în aceeași fereastră → limitată
  const over = connThrottle(hist, now);
  assert.equal(over.limited, true);
  // și NU extinde fereastra (nu adaugă hit peste prag)
  assert.equal(over.hist.length, CONN_MAX);
});

test("fereastra se resetează după CONN_WINDOW → înregistrarea în masă e doar încetinită, nu blocată permanent", () => {
  const t0 = 5_000_000;
  let hist;
  for (let i = 0; i < CONN_MAX; i++) hist = connThrottle(hist, t0).hist;
  assert.equal(connThrottle(hist, t0).limited, true);
  // după fereastră, hit-urile vechi expiră → din nou permis
  const later = t0 + CONN_WINDOW + 1;
  assert.equal(connThrottle(hist, later).limited, false);
});

test("IP-uri diferite au istoric independent (apelantul cheie pe IP)", () => {
  const now = 9_000_000;
  let a, b;
  for (let i = 0; i < CONN_MAX; i++) a = connThrottle(a, now).hist;
  assert.equal(connThrottle(a, now).limited, true);   // IP A saturat
  assert.equal(connThrottle(b, now).limited, false);  // IP B neatins
});
