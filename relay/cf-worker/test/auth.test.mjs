// Teste pe AUTH RELEU (C1) — importă verifyReg-ul REAL din src/auth.js.
// Rulează în node (crypto.subtle global, ca în Workers). `npm test` în cf-worker.
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyReg, didFromKeys } from "../src/auth.mjs";

const b64 = (b) => Buffer.from(b).toString("base64");
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
const ls = (idKey, authPub) => JSON.stringify({ idKey: b64(idKey), authPub: b64(authPub) });

async function makeIdentity() {
  const kp = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const authPub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const idKey = rnd(33);
  const did = await didFromKeys(b64(idKey), b64(authPub));
  const sign = async (n) => new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, kp.privateKey, new TextEncoder().encode(n)));
  return { idKey, authPub, did, sign };
}

test("reg valid → ACCEPTAT", async () => {
  const a = await makeIdentity();
  const sig = b64(await a.sign("n1"));
  assert.equal(await verifyReg(a.did, ls(a.idKey, a.authPub), { sig }, "n1"), true);
});

test("nonce greșit → RESPINS (anti-replay challenge)", async () => {
  const a = await makeIdentity();
  const sig = b64(await a.sign("n1"));
  assert.equal(await verifyReg(a.did, ls(a.idKey, a.authPub), { sig }, "n2"), false);
});

test("DID-HIJACK: authPub atacator pe DID-ul victimei → RESPINS", async () => {
  const victim = await makeIdentity();
  const attacker = await makeIdentity();
  const sig = b64(await attacker.sign("n"));
  assert.equal(await verifyReg(victim.did, ls(victim.idKey, attacker.authPub), { sig }, "n"), false);
});

test("bundle fără authPub → RESPINS (fail-closed)", async () => {
  const a = await makeIdentity();
  const sig = b64(await a.sign("n"));
  assert.equal(await verifyReg(a.did, JSON.stringify({ idKey: b64(a.idKey) }), { sig }, "n"), false);
});

test("auth lipsă → RESPINS", async () => {
  const a = await makeIdentity();
  assert.equal(await verifyReg(a.did, ls(a.idKey, a.authPub), null, "n"), false);
});

test("didFromKeys → format did:key:z6Mk + 40 base32", async () => {
  assert.match(await didFromKeys(b64(rnd(33)), b64(rnd(32))), /^did:key:z6Mk[a-z2-7]{40}$/);
});
