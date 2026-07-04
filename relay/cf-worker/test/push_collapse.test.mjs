// T4 — push collapse (notification.tag) + notify-once (helperi PURI din src/push.mjs).
// pushNotify se cheamă pt FIECARE plic offline (o poză = ~125 bucăți + resend-uri). Verificăm că:
//  - payload-ul poartă collapse_key = DID destinatar + notification.tag CONSTANT (înlocuiește în tavă),
//  - payload-ul rămâne generic (zero conținut spre Google), collapse_key NU stă pe plic,
//  - notify-once: o furtună produce O SINGURĂ notificare (fix QA C4 — sunetul nu se mai re-alerta),
//  - după ce destinatarul revine online (flag șters la reg), o nouă perioadă offline notifică iar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPushMessage, shouldPush, PUSH_NOTIF_TAG } from "../src/push.mjs";

const DID_B = "did:key:zDestinatarBBBB";
const DID_C = "did:key:zAltulCCCC";

test("buildPushMessage — collapse_key + notification.tag, priority high, payload generic", () => {
  const msg = buildPushMessage("fcm-token-B", DID_B);
  assert.equal(msg.android.collapse_key, DID_B, "collapse_key = destinatar (colapsează FCM nelivrat)");
  assert.equal(msg.android.notification.tag, PUSH_NOTIF_TAG, "tag de tavă → notificarea nouă O ÎNLOCUIEȘTE pe precedenta (fix C4)");
  assert.equal(msg.android.priority, "high");
  assert.equal(msg.notification.title, "Blink");
  assert.equal(msg.notification.body, "Mesaj nou criptat"); // generic, fără conținut
  assert.equal("collapse_key" in msg, false, "collapse_key stă pe android, NU pe plic (fără scurgere de metadate)");
});

test("tag de tavă e CONSTANT (2 destinatari → același tag → o notificare pe device)", () => {
  const a = buildPushMessage("tok", DID_B).android.notification.tag;
  const b = buildPushMessage("tok", DID_C).android.notification.tag;
  assert.equal(a, b, "tag constant → toate notificările noi colapsează într-una singură (C4.4)");
});

test("notify-once: furtună de 130 plicuri offline → O SINGURĂ notificare (sunetul nu se re-alertă)", () => {
  // modelează pushNotify: flag persistent `pushed:<DID>` gate-uiește (get → shouldPush → set).
  let pushed; // storage.get("pushed:DID") = undefined la început
  let sent = 0;
  for (let i = 0; i < 125; i++) if (shouldPush(pushed)) { sent++; pushed = 1; } // bucățile pozei
  for (let i = 0; i < 5; i++) if (shouldPush(pushed)) { sent++; pushed = 1; }   // resend-uri/ack-uri
  assert.equal(sent, 1, "o furtună de 130 → un singur push (fără re-alertă de sunet)");
});

test("notify-once se resetează când destinatarul revine online (flag șters la reg)", () => {
  let pushed;
  let sent = 0;
  for (let i = 0; i < 10; i++) if (shouldPush(pushed)) { sent++; pushed = 1; }
  assert.equal(sent, 1);
  pushed = undefined; // reg → storage.delete("pushed:DID")
  let sent2 = 0;
  for (let i = 0; i < 10; i++) if (shouldPush(pushed)) { sent2++; pushed = 1; }
  assert.equal(sent2, 1, "următoarea perioadă offline notifică din nou");
});
