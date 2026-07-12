// Faza 3.4 — push FCM helpers (src/push.mjs). Rulează în node (crypto.subtle global, ca în Workers).
import { test } from "node:test";
import assert from "node:assert/strict";
import { b64url, b64urlStr, pemToArrayBuffer, buildServiceJwt } from "../src/push.mjs";

test("b64urlStr — base64url url-safe (fără + / =, fără padding)", () => {
  // operează pe ASCII (JSON header/claim) — fără padding și fără caractere url-unsafe
  assert.equal(b64urlStr("hi"), "aGk");
  assert.ok(!/[+/=]/.test(b64urlStr(">>>?{}")));
});

test("b64url — octeți → base64url", () => {
  const out = b64url(new Uint8Array([255, 255, 254]).buffer);
  assert.ok(!/[+/=]/.test(out));
});

// generează o cheie RSA reală + PEM PKCS#8 pt round-trip
async function makeKeyPem() {
  const kp = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const der = new Uint8Array(await crypto.subtle.exportKey("pkcs8", kp.privateKey));
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  // antet PEM ca șir literal; cheia e generată aici, la runtime — nu e material secret
  const pem = "-----BEGIN PRIVATE KEY-----\n" + btoa(bin).match(/.{1,64}/g).join("\n") + "\n-----END PRIVATE KEY-----\n"; // gitleaks:allow
  return { pem, pub: kp.publicKey };
}

test("pemToArrayBuffer — acceptă PEM cu \\n escapat (ca în secretele Worker)", async () => {
  const { pem } = await makeKeyPem();
  const escaped = pem.replace(/\n/g, "\\n"); // cum vine din env var
  // ambele forme trebuie să dea o cheie importabilă
  for (const p of [pem, escaped]) {
    const key = await crypto.subtle.importKey("pkcs8", pemToArrayBuffer(p),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    assert.ok(key);
  }
});

test("buildServiceJwt — 3 segmente, semnătură validă, claim corect", async () => {
  const { pem, pub } = await makeKeyPem();
  const now = 1_700_000_000;
  const jwt = await buildServiceJwt("svc@blink.iam.gserviceaccount.com", pem, now);
  const parts = jwt.split(".");
  assert.equal(parts.length, 3);

  // header + claim decodează corect
  const dec = (s) => JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  assert.deepEqual(dec(parts[0]), { alg: "RS256", typ: "JWT" });
  const claim = dec(parts[1]);
  assert.equal(claim.iss, "svc@blink.iam.gserviceaccount.com");
  assert.equal(claim.aud, "https://oauth2.googleapis.com/token");
  assert.equal(claim.iat, now);
  assert.equal(claim.exp, now + 3600);
  assert.match(claim.scope, /firebase\.messaging/);

  // semnătura verifică cu cheia publică (peste header.claim)
  const sig = Uint8Array.from(Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64"));
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pub, sig,
    new TextEncoder().encode(parts[0] + "." + parts[1]));
  assert.equal(ok, true);
});
