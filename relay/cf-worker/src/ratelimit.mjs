// Token-bucket cu fereastră glisantă — PUR (fără DO/storage), deci testabil în node:test.
// Folosit de rate-limit-ul pe getbundle (#B1: anti-drenare a poolului de one-time prekey-uri).
//
// `hist` = timestamp-urile hit-urilor din fereastră (poate fi undefined la prima cerere).
// Întoarce { limited, hist }: `hist` e lista curățată (fără intrările expirate) + noul hit dacă
// nu s-a depășit pragul. Apelantul o re-stochează. La `limited=true` NU adaugă hit (nu extinde
// fereastra la fiecare încercare peste prag).
export function bucketHit(hist, now, max, windowMs) {
  const kept = (hist || []).filter((t) => now - t < windowMs);
  if (kept.length >= max) return { limited: true, hist: kept };
  kept.push(now);
  return { limited: false, hist: kept };
}
