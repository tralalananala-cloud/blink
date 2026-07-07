/** Slice conversații + mesaje (Faza 3.1) — bulk-ul fostului store.ts. Scrierile O(1) în SQLite
 *  trec prin `persist*` (messagePersistence); cross-slice (settings) prin get()/set() pe AppState. */
import { ChatSlice, Slice } from "../types";
import { GROUP_MAX } from "../../messaging/codec";
import { Conversation, Message, MsgStatus, seedContacts, seedConversations } from "../../data/mockData";
import { notifyMessage } from "../../notify";
import { dbRemoveItem, DB_KEYS } from "../../storage/db";
import { wipeMessages } from "../../storage/messages";
import {
  persistAppend, persistStatus, persistUpdate, persistDelete, persistConvDelete, setSuspendMsgSync,
} from "../messagePersistence";

// Rang de stare: o bifă urcă, niciodată nu coboară (sending<sent<relayed<delivered<read).
const RANK: Record<MsgStatus, number> = { sending: 0, received: 0, sent: 1, relayed: 2, delivered: 3, read: 4 };

function didId(did: string): string {
  return "d_" + did.replace(/[^a-zA-Z0-9]/g, "").slice(-12);
}

/** Roster de grup: fără duplicate, tăiat la GROUP_MAX (capul e politică, nu limită tehnică). */
function dedupeCap(dids: string[]): string[] {
  return Array.from(new Set(dids)).slice(0, GROUP_MAX);
}

export const createChatSlice: Slice<ChatSlice> = (set, get) => ({
  conversations: seedConversations(),

  appendMessage: (convId, text, fromMe, attachment, meta) => {
    // Dedupe la recepție: dacă există deja un mesaj cu același remoteId, nu-l mai adăuga
    // (resend după ack pierdut / livrare dublă). Întoarce id-ul existent, fără notificare.
    if (!fromMe && meta?.remoteId) {
      // În grupuri remoteId-ul e unic doar per expeditor → dedupe pe (remoteId, sender).
      const dup = get().conversations.find((c) => c.id === convId)?.messages
        .find((m) => m.remoteId === meta.remoteId && (!meta.sender || m.sender === meta.sender));
      if (dup) return dup.id;
    }
    if (!fromMe) {
      const st = get();
      const conv = st.conversations.find((c) => c.id === convId);
      if (st.settings.notifications && conv) {
        const body = attachment ? `[${attachment.kind}]` : text;
        const preview = meta?.senderName ? `${meta.senderName}: ${body}` : body;
        notifyMessage(conv.name, preview, conv.id);
      }
    }
    const id = meta?.id ?? `${convId}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const status: MsgStatus = meta?.status ?? (fromMe ? "sending" : "received");
    const m: Message = { id, text, fromMe, ts: Date.now(), status, attachment, remoteId: meta?.remoteId, sender: meta?.sender, senderName: meta?.senderName };
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, lastTs: m.ts, messages: [...c.messages, m] } : c,
      ),
    }));
    persistAppend(convId, m); // M1: un singur INSERT (vs rescrierea conversației)
    return id;
  },

  markMsgStatus: (peerDid, msgId, status) => {
    let changed = false;
    let convId: string | undefined;
    set((s) => {
      const conversations = s.conversations.map((c) => {
        if (c.did !== peerDid) return c;
        const messages = c.messages.map((m) => {
          if (m.id !== msgId || !m.fromMe || RANK[status] <= RANK[m.status]) return m;
          changed = true; convId = c.id;
          return { ...m, status };
        });
        return changed ? { ...c, messages } : c;
      });
      return changed ? { conversations } : {};
    });
    if (changed && convId) persistStatus(convId, msgId, status); // M1: un singur UPDATE de rând
  },

  takeReadReceipts: (peerDid) => {
    const ids: string[] = [];
    const persisted: { convId: string; localId: string }[] = [];
    set((s) => {
      let changed = false;
      const conversations = s.conversations.map((c) => {
        if (c.did !== peerDid) return c;
        const messages = c.messages.map((m) => {
          if (!m.fromMe && m.remoteId && !m.readAckSent) {
            ids.push(m.remoteId);
            persisted.push({ convId: c.id, localId: m.id });
            changed = true;
            return { ...m, readAckSent: true };
          }
          return m;
        });
        return changed ? { ...c, messages } : c;
      });
      return changed ? { conversations } : {};
    });
    // persistă flag-ul readAckSent → după restart nu retrimitem confirmările de citire
    for (const { convId, localId } of persisted) persistUpdate(convId, localId, (m) => ({ ...m, readAckSent: true }));
    return ids;
  },

  editMessage: (convId, msgId, text) => {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId
          ? { ...c, messages: c.messages.map((m) => (m.id === msgId ? { ...m, text, edited: true } : m)) }
          : c,
      ),
    }));
    persistUpdate(convId, msgId, (m) => ({ ...m, text, edited: true }));
  },

  deleteMessage: (convId, msgId) => {
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId
          ? { ...c, messages: c.messages.filter((m) => m.id !== msgId), lastTs: c.lastTs }
          : c,
      ),
    }));
    persistDelete(msgId);
  },

  applyRemoteEdit: (fromDid, remoteId, text) => {
    let convId: string | undefined; let localId: string | undefined;
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.did !== fromDid) return c;
        return { ...c, messages: c.messages.map((m) => {
          if (m.remoteId === remoteId && !m.fromMe) { convId = c.id; localId = m.id; return { ...m, text, edited: true }; }
          return m;
        }) };
      }),
    }));
    if (convId && localId) persistUpdate(convId, localId, (m) => ({ ...m, text, edited: true }));
  },

  applyRemoteDelete: (fromDid, remoteId) => {
    let localId: string | undefined;
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.did !== fromDid) return c;
        const hit = c.messages.find((m) => m.remoteId === remoteId && !m.fromMe);
        if (hit) localId = hit.id;
        return { ...c, messages: c.messages.filter((m) => !(m.remoteId === remoteId && !m.fromMe)) };
      }),
    }));
    if (localId) persistDelete(localId);
  },

  applyRemoteDeleteConv: (fromDid) => {
    const removed = get().conversations.filter((c) => !c.group && c.did === fromDid);
    set((s) => ({ conversations: s.conversations.filter((c) => !(!c.group && c.did === fromDid)) }));
    for (const c of removed) persistConvDelete(c.id);
  },

  // B2 — contactul și-a resetat identitatea (decriptare eșuată) → arată banner re-pair
  flagNeedsRepair: (fromDid) =>
    set((s) => {
      const conv = s.conversations.find((c) => !c.group && c.did === fromDid);
      if (!conv || conv.needsRepair) return {};
      return { conversations: s.conversations.map((c) => (c.id === conv.id ? { ...c, needsRepair: true } : c)) };
    }),
  clearNeedsRepair: (fromDid) =>
    set((s) => {
      const conv = s.conversations.find((c) => !c.group && c.did === fromDid && c.needsRepair);
      if (!conv) return {};
      return { conversations: s.conversations.map((c) => (c.id === conv.id ? { ...c, needsRepair: false } : c)) };
    }),
  // Userul a verificat safety number → persistă, ca bannerul „verify" să NU mai reapară.
  markVerified: (convId) =>
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === convId ? { ...c, verified: true } : c)) })),

  setConvLocked: (convId, locked) =>
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === convId ? { ...c, locked } : c)) })),

  setBurnTimer: (convId, ms) =>
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === convId ? { ...c, burnAfterReadMs: ms } : c)) })),

  markRead: (convId) => {
    const now = Date.now();
    const touched: string[] = [];
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== convId || !c.burnAfterReadMs) return c;
        return { ...c, messages: c.messages.map((m) => {
          if (m.readAt) return m;
          touched.push(m.id);
          return { ...m, readAt: now };
        }) };
      }),
    }));
    for (const id of touched) persistUpdate(convId, id, (m) => (m.readAt ? m : { ...m, readAt: now }));
  },

  clearUnread: (convId) =>
    set((s) => {
      const conv = s.conversations.find((c) => c.id === convId);
      if (!conv || conv.unread === 0) return {};
      return { conversations: s.conversations.map((c) => (c.id === convId ? { ...c, unread: 0 } : c)) };
    }),

  burnSweep: () => {
    const now = Date.now();
    const removedIds: string[] = [];
    set((s) => {
      let changed = false;
      const conversations = s.conversations.map((c) => {
        if (!c.burnAfterReadMs) return c;
        const kept: typeof c.messages = [];
        for (const m of c.messages) {
          if (m.readAt && m.readAt + c.burnAfterReadMs! <= now) removedIds.push(m.id);
          else kept.push(m);
        }
        if (kept.length !== c.messages.length) changed = true;
        return kept.length !== c.messages.length ? { ...c, messages: kept } : c;
      });
      return changed ? { conversations } : {};
    });
    for (const id of removedIds) persistDelete(id);
  },

  deleteConversation: (convId) => {
    set((s) => ({ conversations: s.conversations.filter((c) => c.id !== convId) }));
    persistConvDelete(convId);
  },

  openDirect: (contact) => {
    const existing = get().conversations.find((c) => !c.group && c.did === contact.did);
    if (existing) return existing.id;
    const id = didId(contact.did);
    set((s) => ({
      conversations: [
        { id, name: contact.name, did: contact.did, verified: contact.verified, unread: 0, group: false, lastTs: Date.now(), messages: [] },
        ...s.conversations,
      ],
    }));
    return id;
  },

  receiveMessage: (fromDid, text, remoteId, attachment, senderName) => {
    const st = get();
    if (st.blocked.includes(fromDid)) return;
    const contact = st.contacts.find((c) => c.did === fromDid);
    // nume afișat: contactul salvat > numele trimis de expeditor > placeholder DID
    const placeholder = fromDid.slice(0, 18) + "…";
    const displayName = contact?.name || (senderName && senderName.trim()) || placeholder;
    let conv = st.conversations.find((c) => !c.group && c.did === fromDid);
    if (!conv) {
      conv = {
        id: didId(fromDid), name: displayName, did: fromDid,
        verified: contact?.verified ?? false, unread: 0, group: false, lastTs: Date.now(), messages: [],
      };
      set((s) => ({ conversations: [conv!, ...s.conversations] }));
    } else if (!contact && senderName && senderName.trim() && (conv.name === placeholder || conv.name.startsWith("did:"))) {
      // conversația avea nume-placeholder → actualizează cu numele trimis de expeditor
      const nm = senderName.trim();
      set((s) => ({ conversations: s.conversations.map((c) => (c.id === conv!.id ? { ...c, name: nm } : c)) }));
    }
    // Necitite doar pt un mesaj GENUIN nou: appendMessage dedupează resend-urile pe remoteId
    // (același mesaj re-livrat din coadă după ce app-ul a fost ucis offline). Fără garda asta,
    // 6 copii ale aceluiași mesaj umflau contorul la „6 necitite" pt 2 mesaje reale (QA C4).
    const isDup = !!remoteId && !!get().conversations.find((c) => c.id === conv!.id)?.messages.some((m) => m.remoteId === remoteId && !m.fromMe);
    st.appendMessage(conv.id, text, false, attachment, { remoteId }); // fromMe=false → notificare + reține remoteId
    if (!isDup) set((s) => ({ conversations: s.conversations.map((c) => (c.id === conv!.id ? { ...c, unread: c.unread + 1 } : c)) }));
  },

  createGroup: (name, memberDids) => {
    // gid = identitatea grupului PE SÂRMĂ (călătorește în gt/gc) și totodată id-ul conversației.
    const gid = "g_" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const myDid = get().identity?.did;
    const members = dedupeCap(myDid ? [myDid, ...memberDids] : memberDids);
    set((s) => ({
      conversations: [
        { id: gid, name: name.trim() || "Grup nou", did: gid, admin: myDid, verified: false, unread: 0, group: true, members, lastTs: Date.now(), messages: [] },
        ...s.conversations,
      ],
    }));
    return gid;
  },

  receiveGroupMessage: (fromDid, gid, text, remoteId, attachment, senderName, gname) => {
    const st = get();
    if (st.blocked.includes(fromDid)) return;
    const contact = st.contacts.find((c) => c.did === fromDid);
    const senderShown = contact?.name || (senderName && senderName.trim()) || fromDid.slice(0, 18) + "…";
    let conv = st.conversations.find((c) => c.group && c.id === gid);
    if (!conv) {
      // Primul mesaj dintr-un grup necunoscut → auto-creare cu ce știm (expeditorul + numele
      // de pe plic); roster-ul complet + adminul sosesc cu gc:create (ordinea nu contează).
      conv = {
        id: gid, name: (gname && gname.trim()) || "Grup", did: gid,
        verified: false, unread: 0, group: true, members: [fromDid], lastTs: Date.now(), messages: [],
      };
      set((s) => ({ conversations: [conv!, ...s.conversations] }));
    }
    const isDup = !!remoteId && !!get().conversations.find((c) => c.id === gid)
      ?.messages.some((m) => m.remoteId === remoteId && m.sender === fromDid && !m.fromMe);
    st.appendMessage(gid, text, false, attachment, { remoteId, sender: fromDid, senderName: senderShown });
    if (!isDup) set((s) => ({ conversations: s.conversations.map((c) => (c.id === gid ? { ...c, unread: c.unread + 1 } : c)) }));
  },

  applyGroupCtl: (fromDid, gc) => {
    const st = get();
    if (st.blocked.includes(fromDid)) return;
    const conv = st.conversations.find((c) => c.group && c.id === gc.gid);
    const patch = (p: Partial<Conversation>) =>
      set((s) => ({ conversations: s.conversations.map((c) => (c.id === gc.gid ? { ...c, ...p } : c)) }));
    if (gc.act === "create") {
      const members = dedupeCap([fromDid, ...(gc.members ?? [])]); // creatorul e mereu în roster
      const name = gc.name?.trim();
      if (!conv) {
        set((s) => ({
          conversations: [
            { id: gc.gid, name: name || "Grup", did: gc.gid, admin: fromDid, verified: false, unread: 0, group: true, members, lastTs: Date.now(), messages: [] },
            ...s.conversations,
          ],
        }));
      } else if (!conv.admin || conv.admin === fromDid) {
        // conv auto-creată de un gt sosit înaintea gc-ului → completează roster/nume/admin
        patch({ admin: fromDid, members, ...(name ? { name } : {}) });
      }
      return;
    }
    if (!conv) return;
    if (gc.act === "leave") {
      patch({ members: (conv.members ?? []).filter((d) => d !== fromDid) });
      return;
    }
    if (conv.admin !== fromDid) return; // add/remove = doar adminul
    if (gc.act === "add") patch({ members: dedupeCap([...(conv.members ?? []), ...(gc.members ?? [])]) });
    if (gc.act === "remove") patch({ members: (conv.members ?? []).filter((d) => !(gc.members ?? []).includes(d)) });
  },

  markGroupMsgStatus: (gid, msgId, status) => {
    let changed = false;
    set((s) => {
      const conversations = s.conversations.map((c) => {
        if (!c.group || c.id !== gid) return c;
        const messages = c.messages.map((m) => {
          if (m.id !== msgId || !m.fromMe || RANK[status] <= RANK[m.status]) return m;
          changed = true;
          return { ...m, status };
        });
        return changed ? { ...c, messages } : c;
      });
      return changed ? { conversations } : {};
    });
    if (changed) persistStatus(gid, msgId, status);
  },

  // Igienă RAM — scoate textele decriptate din memorie (la lock pe background).
  // Sigur DOAR cu M1 (mesajele sunt în SQLite → se re-hidratează la deblocare).
  clearMessagesFromMemory: () => {
    // suspendMsgSync oprește orice scriere cât RAM-ul e intenționat gol; ce sosește în fereastra
    // blocată rămâne în state și e re-persistat de hydrateMessages la deblocare.
    setSuspendMsgSync(true);
    set((s) => ({ conversations: s.conversations.map((c) => (c.messages.length ? { ...c, messages: [] } : c)) }));
  },

  wipe: () => {
    dbRemoveItem(DB_KEYS.store);
    dbRemoveItem(DB_KEYS.sessions);
    void wipeMessages(); // M1 — golește și mesajele din SQLite
    set({ onboarded: false, identity: null, conversations: seedConversations(), contacts: seedContacts(), blocked: [] });
  },
});
