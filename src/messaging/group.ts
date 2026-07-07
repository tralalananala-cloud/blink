/**
 * Lot GRUPURI v1 (G3) — fan-out pairwise: un mesaj de grup = N plicuri 1:1 prin sesiunile
 * libsignal existente (aceleași garanții ca 1:1; releul vede N trimiteri, nu conținut).
 *
 * Fiabilitate: refolosește clasa Outbox NEATINSĂ, cu chei compuse `msgId|did` — coada offline
 * și resend-ul pe ack-timeout merg PER MEMBRU (tracking-ul 1:1 din relay ar suprascrie între
 * membri, având același msgId). `text`-ul intrărilor e pachetul JSON {gid,gname,text}; Outbox
 * le tratează opac.
 *
 * Bifele de grup sunt AGREGATE și oneste: ✓ = predat cel puțin unui membru,
 * ✓✓ delivered/read = TOȚI membrii au confirmat. Progresul e în RAM — după restart mesajul
 * rămâne la ultima bifă atinsă (limitare v1, documentată).
 *
 * Cârligele spre relay (ack/ready/reset) sunt injectate cu setGroupHooks — fără import circular.
 */
import { relay } from "./relay";
import { Outbox } from "./outbox";
import { AckKind, ctl, GroupAct } from "./codec";
import { useApp } from "../state/store";
import { Attachment } from "../data/mockData";

type Progress = { gid: string; expected: Set<string>; delivered: Set<string>; read: Set<string> };
const progress = new Map<string, Progress>(); // msgId → agregatul bifelor per membru

const keyOf = (msgId: string, did: string) => `${msgId}|${did}`;
const msgIdOf = (key: string) => key.slice(0, key.indexOf("|"));

const groupOutbox = new Outbox({
  isConnected: () => relay.isConnected(),
  // flush/resend: despachetează {gid,gname,text} și retrimite plicul gt către membrul din cheie
  sendText: async (to, packed, key) => {
    const g = JSON.parse(packed);
    const r = await relay.sendGroupOne(to, g, msgIdOf(key));
    if (r.ok) {
      groupOutbox.trackPending(key, { to, kind: "text", text: packed }); // resend păstrează attempts
      useApp.getState().markGroupMsgStatus(g.gid, msgIdOf(key), "sent");
    }
  },
  sendMedia: async () => {}, // media de grup nu se cozește (v1: cere conexiune)
  trySendAck: async () => false, // confirmările primite merg prin outbox-ul 1:1 al relay-ului
});

function myDid(): string | null { return useApp.getState().identity?.did ?? null; }
function groupConv(gid: string) { return useApp.getState().conversations.find((c) => c.group && c.id === gid); }
/** Destinatarii fan-out-ului: roster-ul fără mine. */
function others(gid: string): string[] {
  const me = myDid();
  return (groupConv(gid)?.members ?? []).filter((d) => d !== me);
}

/** Trimite un text în grup: N plicuri gt cu ACELAȘI msgId, tracking + coadă per membru. */
export async function sendGroupText(gid: string, text: string, msgId: string): Promise<{ ok: boolean; sentTo: number; total: number }> {
  const conv = groupConv(gid);
  const dids = others(gid);
  if (!conv || !dids.length) return { ok: false, sentTo: 0, total: dids.length };
  progress.set(msgId, { gid, expected: new Set(dids), delivered: new Set(), read: new Set() });
  const packed = JSON.stringify({ gid, gname: conv.name, text });
  let sent = 0;
  for (const did of dids) {
    const key = keyOf(msgId, did);
    if (!relay.isConnected()) { groupOutbox.queueOut({ to: did, kind: "text", text: packed, id: key }); continue; }
    const r = await relay.sendGroupOne(did, { gid, gname: conv.name, text }, msgId);
    if (r.ok) { groupOutbox.trackPending(key, { to: did, kind: "text", text: packed }); sent++; }
    else groupOutbox.queueOut({ to: did, kind: "text", text: packed, id: key }); // pleacă la reconectare
  }
  if (sent > 0) useApp.getState().markGroupMsgStatus(gid, msgId, "sent"); // ✓ = predat cel puțin o dată
  return { ok: sent > 0 || dids.length > 0, sentTo: sent, total: dids.length };
}

/** Media în grup: N trimiteri cu gid pe antet. V1: cere conexiune (media nu se cozește). */
export async function sendGroupMedia(gid: string, att: Attachment, msgId: string): Promise<{ ok: boolean; sentTo: number; total: number }> {
  const dids = others(gid);
  if (!dids.length || !relay.isConnected()) return { ok: false, sentTo: 0, total: dids.length };
  progress.set(msgId, { gid, expected: new Set(dids), delivered: new Set(), read: new Set() });
  let sent = 0;
  for (const did of dids) {
    const r = await relay.sendMedia(did, att, msgId, gid);
    if (r.ok) sent++;
  }
  if (sent > 0) useApp.getState().markGroupMsgStatus(gid, msgId, "sent");
  return { ok: sent > 0, sentTo: sent, total: dids.length };
}

/** După createGroup: anunță toți membrii cu gc:create (roster complet + nume). */
export function announceGroup(gid: string): void {
  const conv = groupConv(gid);
  if (!conv) return;
  const obj = ctl.groupCtl(gid, "create", { members: conv.members, name: conv.name });
  for (const did of others(gid)) void relay.sendGroupCtl(did, obj);
}

/** Adaugă membri (doar adminul; garda e în applyGroupCtl): noii primesc create (roster complet), vechii add. */
export function addMembers(gid: string, newDids: string[]): void {
  const me = myDid();
  if (!me) return;
  const before = new Set(groupConv(gid)?.members ?? []);
  useApp.getState().applyGroupCtl(me, { gid, act: "add" as GroupAct, members: newDids });
  const conv = groupConv(gid);
  if (!conv) return;
  const added = (conv.members ?? []).filter((d) => !before.has(d));
  if (!added.length) return; // nimic adăugat (nu-s admin / duplicate / peste cap)
  const createObj = ctl.groupCtl(gid, "create", { members: conv.members, name: conv.name });
  const addObj = ctl.groupCtl(gid, "add", { members: added });
  for (const did of others(gid)) void relay.sendGroupCtl(did, added.includes(did) ? createObj : addObj);
}

/** Scoate membri (doar adminul): anunță roster-ul VECHI — și cei scoși trebuie să afle. */
export function removeMembers(gid: string, dids: string[]): void {
  const me = myDid();
  if (!me) return;
  const notify = others(gid); // înainte de mutație, ca să-i prindă și pe cei scoși
  useApp.getState().applyGroupCtl(me, { gid, act: "remove" as GroupAct, members: dids });
  const obj = ctl.groupCtl(gid, "remove", { members: dids });
  for (const did of notify) void relay.sendGroupCtl(did, obj);
}

/** Ieși din grup: anunți membrii, apoi te scoți local din roster. */
export function leaveGroup(gid: string): void {
  const me = myDid();
  if (!me) return;
  const obj = ctl.groupCtl(gid, "leave");
  for (const did of others(gid)) void relay.sendGroupCtl(did, obj);
  useApp.getState().applyGroupCtl(me, { gid, act: "leave" as GroupAct });
}

// Ack de la un membru: oprește resend-ul LUI + urcă bifele agregate când TOȚI au confirmat.
function onAck(fromDid: string, msgId: string, s: AckKind): void {
  const p = progress.get(msgId);
  if (!p || !p.expected.has(fromDid)) return;
  groupOutbox.onDelivered(keyOf(msgId, fromDid));
  p.delivered.add(fromDid); // „read" implică livrat
  if (s === "read") p.read.add(fromDid);
  const st = useApp.getState();
  if (p.read.size >= p.expected.size) { st.markGroupMsgStatus(p.gid, msgId, "read"); progress.delete(msgId); }
  else if (p.delivered.size >= p.expected.size) st.markGroupMsgStatus(p.gid, msgId, "delivered");
}

relay.setGroupHooks({
  onAck,
  onReady: () => { groupOutbox.startSweep(); groupOutbox.flush(); },
  onReset: () => { groupOutbox.clear(); progress.clear(); },
});
