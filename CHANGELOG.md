# Changelog

All notable changes to Blink. User-visible versioning; the **1:1** message format stays
compatible across versions — **you update without reinstalling and without re-scanning a QR code**.

## [1.5.0] — 2026-07-12 · Bluetooth: messages without internet

Blink can deliver messages **directly phone-to-phone, over Bluetooth**, when the recipient is
nearby. No internet, no relay, no server at all. Content stays end-to-end encrypted, exactly like
over the relay — Bluetooth is just another pipe the same sealed envelope travels through.

Tested on two phones in airplane mode: text, photos and voice messages arrive, with a double check.

### Added
- **Nearby Bluetooth (experimental)** — turned on from Settings → Transport. When the recipient
  is in range, the message goes over Bluetooth; if not, it falls back to the relay, as before.
- **Stay reachable even with the app closed** — a background service (with a persistent
  notification) keeps Bluetooth active so you receive messages without keeping the app open. It
  can be turned off: then Bluetooth only runs while you're in the app, and battery cost in your
  pocket is zero.
- **Reticulum transport (experimental)** — routing through a Reticulum gateway instead of the relay.

### Changed
- **Notifications no longer show message content.** By default they read only "New encrypted
  message", so text doesn't appear on the lock screen. Want the preview? Turn it on in
  Settings → Privacy.
- **Photos and voice use much less data** — photos in WebP, voice mono at 32 kbps. A photo sent
  over Bluetooth dropped from ~300KB to ~65KB, so it arrives several times faster.
- The message list opens at the **first unread message**, not at the start of history.

### Fixed
- Messages keep their **order** when a waiting queue drains (on reconnect).
- Voice message playback, which was blocked while the app ran in the background.
- The message list jumping on send and staying hidden under the keyboard.

### Good to know (honest)
- **It is NOT a mesh network.** A message does not hop phone to phone: the recipient must be in
  your own Bluetooth range. Don't rely on it as a censorship-resistant network.
- Requires **v1.5.0 on both phones** — it does not talk to older versions.
- The range is Bluetooth range: a few meters, one room.
- **Radio trace:** while Bluetooth is on, the phone advertises itself with a stable identifier. It
  does not reveal your identity and does not expose messages, but someone physically near you with
  a scanner can notice that the **same phone** passes by. Details in SECURITY.md.
- Bluetooth uses battery while it's on. We listen in short windows to limit the cost, but it isn't
  free.
- After a phone reboot, Bluetooth only starts once you open the app.
- As before: 1:1 conversations stay compatible — you update on top, no QR re-scan.

## [1.4.0] — 2026-07-07 · Groups

Blink has groups, with **exactly the same encryption as 1:1**. It is not a new, unverified group
key: each group message goes out **individually encrypted (libsignal) to each member** — the same
guarantees you already have in face-to-face conversations.

### Added
- **End-to-end encrypted groups.** You create a group, add members from contacts, write text and
  send photos — all E2EE. On each message you see who sent it. The **✓✓** check appears when
  **all** members have confirmed receipt.
- **Group administration.** The creator is the admin: adds and removes members. Anyone can **leave**
  the group; the others are notified, and history stays on your device.

### Honesty
- **It is not "decentralized" and the relay sees the volume.** A group message = N 1:1 sends
  through the blind relay. The relay **does not see the content** (it's encrypted), but it sees you
  sent N envelopes — that is, **how big the group is**, not what you write. Honest about metadata.
- **All members need v1.4+.** The group format is new. A friend on an older version **cannot
  participate** in the group — the message will appear wrong to them (as technical text in a
  separate conversation). Send them the update link before adding them.
- **No MLS, no group keys.** We chose 1:1 fan-out precisely to avoid introducing new cryptography.
  The trade-off: it is efficient for small groups (up to 16 members), not for hundreds.

### Notes
- **1:1 stays re-pair-free.** Face-to-face conversations use the same format as before — you
  update on top of the old version, keeping your identity and conversations. Only **groups**
  require everyone to be on v1.4+.

## [1.2.2] — 2026-07-04 · 1:1 stability

A batch dedicated to the stability of a 1:1 conversation: calm notifications, faster photos with
no location leak, delete-for-both, and zero dead buttons. No network changes →
**update without re-pair**.

### Improved
- **Calm notifications.** With the app closed, you get **one** "New encrypted message"
  notification, not a stack — no matter how many messages or photo chunks arrive, or from how many
  senders. The sound alerts you once, not on a loop. (The content is all there when you open.)
- **Faster photos with no location.** Photos are automatically resized before sending (a few-MB
  photo goes out at ~200 KB) and **re-encoded**, which **completely strips EXIF data, including
  GPS** — your location no longer leaks to the recipient. A large photo no longer blocks texts
  sent right after it.
- **Correct unread counter.** When coming back online after a break, messages re-delivered from
  the queue no longer inflate the unread count — you see exactly how many new messages you have.

### Added
- **Delete the conversation for both.** In the conversation options you can clear the conversation
  on your side and the other's. Honest: **cooperative, not guaranteed** — a contact with a backup,
  screenshot or modified client can keep the messages.
- **Guide for notifications with the app closed (Android).** On first launch, a step helps you
  enable "Autostart" and "No battery restrictions" on phones that aggressively kill background
  apps (OPPO/ColorOS, Xiaomi, Huawei). It's a manufacturer limitation, not Blink's — Signal and
  WhatsApp ask for the same.

### Changed
- **Voice/video calls are temporarily hidden.** The feature wasn't tested enough on real devices;
  we prefer not to show it until it works reliably, instead of a button that doesn't respond. It
  returns in a future version.

### Notes
- **No re-pair:** the on-network message format is unchanged. You update on top of the previous
  version and keep your identity and conversations — no reinstall, no new QR.
