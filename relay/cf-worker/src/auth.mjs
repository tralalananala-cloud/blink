// AUTH RELEU (C1): proprietatea DID-ului dovedită prin semnătură Ed25519.
// DID = base32(sha256(idKey ‖ authPub)). Pur (folosește doar crypto.subtle global) →
// rulează identic în Workers și în node → testabil (vezi test/auth.test.mjs).
const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export function base32(b) {
  let bits = 0, val = 0, out = "";
  for (let i = 0; i < b.length; i++) {
    val = (val << 8) | b[i]; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function b64ToBytes(s) {
  const bin = atob(String(s).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export async function didFromKeys(idKeyB64, authPubB64) {
  const idk = b64ToBytes(idKeyB64), auth = b64ToBytes(authPubB64);
  const pre = new Uint8Array(idk.length + auth.length);
  pre.set(idk, 0); pre.set(auth, idk.length);
  const dig = new Uint8Array(await crypto.subtle.digest("SHA-256", pre));
  return "did:key:z6Mk" + base32(dig).slice(0, 40);
}
// true DOAR dacă: bundle-ul conține idKey+authPub, did === didFromKeys(idKey,authPub),
// iar semnătura peste nonce e validă pt authPub. Orice eroare → false (fail-closed).
export async function verifyReg(did, bundleLs, auth, nonce) {
  try {
    if (!did || !bundleLs || !auth || !auth.sig || !nonce) return false;
    const b = JSON.parse(bundleLs);
    if (!b.idKey || !b.authPub) return false;
    if ((await didFromKeys(b.idKey, b.authPub)) !== did) return false;
    const key = await crypto.subtle.importKey("raw", b64ToBytes(b.authPub), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, b64ToBytes(auth.sig), new TextEncoder().encode(nonce));
  } catch { return false; }
}
