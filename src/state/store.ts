/**
 * State global (zustand). Tine starea de onboarding, identitatea, setarile de
 * transport/privacy si conversatiile (mock). Nu tine NICIODATA chei private —
 * acelea sunt doar in SecureStorage.
 */
import { AppState as RNAppState } from "react-native";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { Identity } from "../crypto/types";
import { TransportStatus } from "../transport/types";
import { transport } from "../transport/mockTransport";
import { Attachment, Contact, Conversation, MsgStatus, seedContacts, seedConversations } from "../data/mockData";
import { notifyMessage } from "../notify";
import { dbGetItem, dbSetItem, dbRemoveItem, DB_KEYS } from "../storage/db";
import { syncConv as dbSyncConv, deleteConvMessages, loadAllMessages, wipeMessages, isMigrated, setMigrated, MESSAGES_IN_DB } from "../storage/messages";

// Magazin persistent CRIPTAT la repaus pentru zustand (Faza 1).
// M5 — scriere debounce-uită: rafalele (bife ✓→✓✓, mesaje rapide) se contopesc
// într-o SINGURĂ criptare+scriere în loc de una per eveniment (store-ul e un blob
// mare, recriptat integral la fiecare schimbare → suprasolicita RAM-ul).
const PERSIST_DELAY = 500;
const pendingWrites = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// GUARD CRITIC: nu scrie nimic în DB până store-ul nu s-a hidratat din DB. Altfel un
// setter timpuriu (montarea unei componente cu starea default conversations=[]) ar
// suprascrie DB-ul cu starea goală ÎNAINTE ca hidratarea să termine = pierdere de date.
// (Expus de font swap: render-ul mai devreme = fereastra de race mai mare.)
let storeHydrated = false;

// M1 — guard-uri pt write-through-ul mesajelor în SQLite (anti-pierdere date):
//  • messagesReady: rămâne false până hydrateMessages() reîncarcă mesajele din SQLite.
//    Cât e false, subscription-ul NU sincronizează (altfel conv-urile hidratate cu
//    messages:[] din blob ar scrie array gol peste SQLite = ștergere la restart).
//  • suspendMsgSync: ridicat de clearMessagesFromMemory (igienă RAM) ca golirea
//    intenționată a RAM-ului să NU se propage în SQLite; coborât la re-hidratare.
let messagesReady = false;
let suspendMsgSync = false;
// Setat de blocul M1: persistă imediat mesajele cu salvare în așteptare (înainte de golirea RAM).
let flushPendingMsgSaves: (() => void) | null = null;

function flushWrites() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (pendingWrites.size === 0) return;
  const batch = Array.from(pendingWrites.entries());
  pendingWrites.clear();
  for (const [name, value] of batch) dbSetItem(name, value); // doar ultima valoare/cheie
}

const encStorage = {
  getItem: (name: string) => dbGetItem(name),
  setItem: (name: string, value: string) => {
    if (!storeHydrated) return; // ignoră scrierile premature (pre-hidratare) — anti-pierdere date
    pendingWrites.set(name, value); // păstrează doar cea mai recentă valoare per cheie
    if (!flushTimer) flushTimer = setTimeout(flushWrites, PERSIST_DELAY);
  },
  removeItem: (name: string) => {
    pendingWrites.delete(name);
    dbRemoveItem(name);
  },
};

// Nu pierde scrieri în așteptare când app-ul pleacă în fundal / se închide.
RNAppState.addEventListener("change", (s) => {
  if (s !== "active") flushWrites();
});

// Rang de stare: o bifă urcă, niciodată nu coboară (sending<sent<relayed<delivered<read).
const RANK: Record<MsgStatus, number> = { sending: 0, received: 0, sent: 1, relayed: 2, delivered: 3, read: 4 };

export type ThemeName = "cipher" | "messenger" | "telegram" | "abyss" | "nebula";

interface Settings {
  themeName: ThemeName;
  transportMode: TransportStatus["mode"];
  sealedSender: boolean;
  screenshotBlocker: boolean;
  selfHostedRelay: boolean;
  biometricLock: boolean;
  notifications: boolean;
  /** Numele/pseudonimul tău — apare la ceilalți când le scrii / te adaugă. */
  profileName: string;
}

interface AppState {
  onboarded: boolean;
  identity: Identity | null;
  conversations: Conversation[];
  contacts: Contact[];
  blocked: string[];
  settings: Settings;

  setOnboarded: (v: boolean) => void;
  setIdentity: (id: Identity) => void;
  /** Adaugă un mesaj; întoarce id-ul lui (pt corelarea bifelor). */
  appendMessage: (
    convId: string,
    text: string,
    fromMe: boolean,
    attachment?: Attachment,
    meta?: { id?: string; remoteId?: string; status?: MsgStatus },
  ) => string;
  /** Urcă starea unui mesaj propriu (bife): sent → delivered → read. */
  markMsgStatus: (peerDid: string, msgId: string, status: MsgStatus) => void;
  /** Mesajele primite ne-confirmate-citit din conv cu peerDid; le marchează trimise. */
  takeReadReceipts: (peerDid: string) => string[];
  editMessage: (convId: string, msgId: string, text: string) => void;
  deleteMessage: (convId: string, msgId: string) => void;
  /** Aplică o editare primită de la peer (după remoteId-ul mesajului lui). */
  applyRemoteEdit: (fromDid: string, remoteId: string, text: string) => void;
  /** Aplică o ștergere de mesaj primită de la peer. */
  applyRemoteDelete: (fromDid: string, remoteId: string) => void;
  /** Aplică o ștergere de conversație primită de la peer. */
  applyRemoteDeleteConv: (fromDid: string) => void;
  flagNeedsRepair: (fromDid: string) => void;
  clearNeedsRepair: (fromDid: string) => void;
  markVerified: (convId: string) => void;
  setConvLocked: (convId: string, locked: boolean) => void;
  setBurnTimer: (convId: string, ms: number | undefined) => void;
  /** Marchează mesajele necitite ca citite (pornește cronometrul de auto-ștergere). */
  markRead: (convId: string) => void;
  /** Pune contorul de necitite (badge-ul) pe 0 la deschiderea conversației. */
  clearUnread: (convId: string) => void;
  /** Șterge definitiv mesajele citite al căror timer a expirat. */
  burnSweep: () => void;
  /** Șterge o conversație din listă. */
  deleteConversation: (convId: string) => void;
  /** Blochează un contact: șterge conversația + contactul + îl marchează blocat. */
  blockContact: (convId: string) => void;
  /** Adaugă un prieten după DID; întoarce false dacă există deja sau e blocat. */
  addContact: (name: string, did: string) => boolean;
  /** Șterge un contact din listă (nu-l blochează). */
  deleteContact: (did: string) => void;
  /** Deschide (sau creează) o conversație 1:1 cu un contact; întoarce id-ul. */
  openDirect: (contact: Contact) => string;
  /** Mesaj primit prin releu (decriptat): găsește/creează conversația + notificare. */
  receiveMessage: (fromDid: string, text: string, remoteId?: string, attachment?: Attachment, senderName?: string) => void;
  /** Creează un grup cu membrii dați; întoarce id-ul conversației. */
  createGroup: (name: string, memberDids: string[]) => string;
  updateSettings: (patch: Partial<Settings>) => void;
  wipe: () => void;
  clearMessagesFromMemory: () => void;
}

function didId(did: string): string {
  return "d_" + did.replace(/[^a-zA-Z0-9]/g, "").slice(-12);
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => ({
  onboarded: false,
  identity: null,
  conversations: seedConversations(),
  contacts: seedContacts(),
  blocked: [],
  settings: {
    themeName: "cipher",
    transportMode: "p2p",
    sealedSender: true,
    screenshotBlocker: true,
    selfHostedRelay: false,
    biometricLock: false,
    notifications: true,
    profileName: "",
  },

  setOnboarded: (v) => set({ onboarded: v }),
  setIdentity: (identity) => set({ identity }),

  appendMessage: (convId, text, fromMe, attachment, meta) => {
    // Dedupe la recepție: dacă există deja un mesaj cu același remoteId, nu-l mai adăuga
    // (resend după ack pierdut / livrare dublă). Întoarce id-ul existent, fără notificare.
    if (!fromMe && meta?.remoteId) {
      const dup = get().conversations.find((c) => c.id === convId)?.messages.find((m) => m.remoteId === meta.remoteId);
      if (dup) return dup.id;
    }
    if (!fromMe) {
      const st = get();
      const conv = st.conversations.find((c) => c.id === convId);
      if (st.settings.notifications && conv) {
        const preview = attachment ? `[${attachment.kind}]` : text;
        notifyMessage(conv.name, preview, conv.id);
      }
    }
    const id = meta?.id ?? `${convId}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
    const status: MsgStatus = meta?.status ?? (fromMe ? "sending" : "received");
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId
          ? {
              ...c,
              lastTs: Date.now(),
              messages: [
                ...c.messages,
                { id, text, fromMe, ts: Date.now(), status, attachment, remoteId: meta?.remoteId },
              ],
            }
          : c,
      ),
    }));
    return id;
  },

  markMsgStatus: (peerDid, msgId, status) =>
    set((s) => {
      let changed = false;
      const conversations = s.conversations.map((c) => {
        if (c.did !== peerDid) return c;
        const messages = c.messages.map((m) => {
          if (m.id !== msgId || !m.fromMe || RANK[status] <= RANK[m.status]) return m;
          changed = true;
          return { ...m, status };
        });
        return changed ? { ...c, messages } : c;
      });
      return changed ? { conversations } : {};
    }),

  takeReadReceipts: (peerDid) => {
    const ids: string[] = [];
    set((s) => {
      let changed = false;
      const conversations = s.conversations.map((c) => {
        if (c.did !== peerDid) return c;
        const messages = c.messages.map((m) => {
          if (!m.fromMe && m.remoteId && !m.readAckSent) {
            ids.push(m.remoteId);
            changed = true;
            return { ...m, readAckSent: true };
          }
          return m;
        });
        return changed ? { ...c, messages } : c;
      });
      return changed ? { conversations } : {};
    });
    return ids;
  },

  editMessage: (convId, msgId, text) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId
          ? { ...c, messages: c.messages.map((m) => (m.id === msgId ? { ...m, text, edited: true } : m)) }
          : c,
      ),
    })),

  deleteMessage: (convId, msgId) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId
          ? { ...c, messages: c.messages.filter((m) => m.id !== msgId), lastTs: c.lastTs }
          : c,
      ),
    })),

  applyRemoteEdit: (fromDid, remoteId, text) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.did === fromDid
          ? { ...c, messages: c.messages.map((m) => (m.remoteId === remoteId && !m.fromMe ? { ...m, text, edited: true } : m)) }
          : c,
      ),
    })),

  applyRemoteDelete: (fromDid, remoteId) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.did === fromDid
          ? { ...c, messages: c.messages.filter((m) => !(m.remoteId === remoteId && !m.fromMe)) }
          : c,
      ),
    })),

  applyRemoteDeleteConv: (fromDid) =>
    set((s) => ({ conversations: s.conversations.filter((c) => !(!c.group && c.did === fromDid)) })),

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

  markRead: (convId) =>
    set((s) => ({
      conversations: s.conversations.map((c) => {
        if (c.id !== convId || !c.burnAfterReadMs) return c;
        const now = Date.now();
        return { ...c, messages: c.messages.map((m) => (m.readAt ? m : { ...m, readAt: now })) };
      }),
    })),

  clearUnread: (convId) =>
    set((s) => {
      const conv = s.conversations.find((c) => c.id === convId);
      if (!conv || conv.unread === 0) return {};
      return { conversations: s.conversations.map((c) => (c.id === convId ? { ...c, unread: 0 } : c)) };
    }),

  burnSweep: () =>
    set((s) => {
      const now = Date.now();
      let changed = false;
      const conversations = s.conversations.map((c) => {
        if (!c.burnAfterReadMs) return c;
        const kept = c.messages.filter((m) => !(m.readAt && m.readAt + c.burnAfterReadMs! <= now));
        if (kept.length !== c.messages.length) changed = true;
        return kept.length !== c.messages.length ? { ...c, messages: kept } : c;
      });
      return changed ? { conversations } : {};
    }),

  deleteConversation: (convId) =>
    set((s) => ({ conversations: s.conversations.filter((c) => c.id !== convId) })),

  blockContact: (convId) =>
    set((s) => {
      const conv = s.conversations.find((c) => c.id === convId);
      const did = conv?.did;
      return {
        conversations: s.conversations.filter((c) => c.id !== convId),
        contacts: did ? s.contacts.filter((c) => c.did !== did) : s.contacts,
        blocked: did && !s.blocked.includes(did) ? [...s.blocked, did] : s.blocked,
      };
    }),

  addContact: (name, did) => {
    const d = did.trim();
    const st = get();
    if (st.blocked.includes(d)) return false;
    const exists = st.contacts.some((c) => c.did === d);
    if (exists) return false;
    set((s) => ({
      contacts: [...s.contacts, { name: name.trim() || d.slice(0, 16), did: d, verified: false, status: "relay" }],
    }));
    return true;
  },

  deleteContact: (did) => set((s) => ({ contacts: s.contacts.filter((c) => c.did !== did) })),

  openDirect: (contact) => {
    const existing = get().conversations.find((c) => !c.group && c.did === contact.did);
    if (existing) return existing.id;
    const id = didId(contact.did);
    set((s) => ({
      conversations: [
        {
          id,
          name: contact.name,
          did: contact.did,
          verified: contact.verified,
          unread: 0,
          group: false,
          lastTs: Date.now(),
          messages: [],
        },
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
    st.appendMessage(conv.id, text, false, attachment, { remoteId }); // fromMe=false → notificare + reține remoteId
    set((s) => ({ conversations: s.conversations.map((c) => (c.id === conv!.id ? { ...c, unread: c.unread + 1 } : c)) }));
  },

  createGroup: (name, memberDids) => {
    const id = "g_" + Date.now().toString(36);
    set((s) => ({
      conversations: [
        {
          id,
          name: name.trim() || "Grup nou",
          did: "did:key:zGroup" + id,
          verified: false,
          unread: 0,
          group: true,
          members: memberDids,
          lastTs: Date.now(),
          messages: [],
        },
        ...s.conversations,
      ],
    }));
    return id;
  },

  updateSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      if (patch.transportMode) transport.setMode(patch.transportMode);
      return { settings };
    }),

  // Igienă RAM — scoate textele decriptate din memorie (la lock pe background).
  // Sigur DOAR cu M1 (mesajele sunt în SQLite → se re-hidratează la deblocare).
  clearMessagesFromMemory: () => {
    flushPendingMsgSaves?.(); // persistă mesajele cu salvare în așteptare ÎNAINTE de golire (anti-pierdere)
    suspendMsgSync = true; // golirea pt RAM nu trebuie să șteargă SQLite; se reîncarcă la deblocare
    set((s) => ({ conversations: s.conversations.map((c) => (c.messages.length ? { ...c, messages: [] } : c)) }));
  },

  wipe: () => {
    dbRemoveItem(DB_KEYS.store);
    dbRemoveItem(DB_KEYS.sessions);
    void wipeMessages(); // M1 — golește și mesajele din SQLite
    set({
      onboarded: false,
      identity: null,
      conversations: seedConversations(),
      contacts: seedContacts(),
      blocked: [],
    });
  },
    }),
    {
      name: DB_KEYS.store,
      storage: createJSONStorage(() => encStorage),
      version: 1,
      // persistă DOAR datele (nu funcțiile); cheile private rămân în SecureStore.
      // M1: pe nativ, mesajele NU mai intră în blob (sunt în SQLite) → blob mic.
      partialize: (s) => ({
        onboarded: s.onboarded,
        identity: s.identity,
        conversations: MESSAGES_IN_DB ? s.conversations.map((c) => ({ ...c, messages: [] })) : s.conversations,
        contacts: s.contacts,
        blocked: s.blocked,
        settings: s.settings,
      }),
    },
  ),
);

// ─── M1: write-through al mesajelor în SQLite ───────────────────────────────
// Când mesajele unei conversații se schimbă (array cu referință nouă), sincronizează
// DOAR acea conversație (debounced 350ms). Detectează și conversațiile șterse.
if (MESSAGES_IN_DB) {
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const scheduleSave = (convId: string) => {
    if (saveTimers.has(convId)) return;
    saveTimers.set(convId, setTimeout(() => {
      saveTimers.delete(convId);
      if (suspendMsgSync) return; // golire RAM în curs → NU scrie array gol peste SQLite
      const c = useApp.getState().conversations.find((x) => x.id === convId);
      if (c) void dbSyncConv(convId, c.messages);
    }, 350));
  };
  // Persistă imediat tot ce e în așteptare (apelat înainte de golirea RAM, ca să nu pierdem
  // mesaje sosite în ultimele ms — surprinde array-ul NEgolit înainte de clearMessagesFromMemory).
  flushPendingMsgSaves = () => {
    for (const [convId, timer] of saveTimers) {
      clearTimeout(timer);
      const c = useApp.getState().conversations.find((x) => x.id === convId);
      if (c) void dbSyncConv(convId, c.messages);
    }
    saveTimers.clear();
  };
  useApp.subscribe((state, prev) => {
    if (state.conversations === prev.conversations) return;
    if (!messagesReady || suspendMsgSync) return; // nu sincroniza în fereastra de pornire / la golirea RAM
    const prevById = new Map(prev.conversations.map((c) => [c.id, c]));
    const curIds = new Set<string>();
    for (const c of state.conversations) {
      curIds.add(c.id);
      const p = prevById.get(c.id);
      if (!p || p.messages !== c.messages) scheduleSave(c.id);
    }
    for (const p of prev.conversations) if (!curIds.has(p.id)) void deleteConvMessages(p.id);
  });
}

/**
 * M1 — la pornire: prima dată migrează mesajele din blobul vechi (deja în memorie)
 * în SQLite; apoi încarcă mesajele din SQLite în store. Apelat din _layout.
 */
export async function hydrateMessages(): Promise<void> {
  if (!MESSAGES_IN_DB) return;
  if (!(await isMigrated())) {
    // Prima rulare cu M1: blobul vechi (deja hidratat) încă are mesajele → mută-le în SQLite.
    const convs = useApp.getState().conversations;
    for (const c of convs) if (c.messages.length) await dbSyncConv(c.id, c.messages);
    await setMigrated();
    messagesReady = true; // de-acum write-through-ul e sigur (mesajele sunt în SQLite)
    suspendMsgSync = false;
    return;
  }
  const byConv = await loadAllMessages();
  // Activează sincronizarea ÎNAINTE de setState, ca restaurarea să se și persiste corect.
  messagesReady = true;
  suspendMsgSync = false;
  useApp.setState((s) => ({
    conversations: s.conversations.map((c) => {
      const loaded = byConv[c.id];
      if (!loaded) return c;                       // nimic în DB pt conv → păstrează memoria
      if (!c.messages.length) return { ...c, messages: loaded };
      // merge defensiv: păstrează mesajele sosite în fereastra de pornire (după id), ordonate pe ts
      const ids = new Set(loaded.map((m) => m.id));
      const extra = c.messages.filter((m) => !ids.has(m.id));
      if (!extra.length) return { ...c, messages: loaded };
      return { ...c, messages: [...loaded, ...extra].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0)) };
    }),
  }));
}

// Deblochează scrierile DOAR după ce hidratarea din DB a terminat (anti-pierdere date,
// vezi guard-ul din encStorage.setItem). Necondiționat de MESSAGES_IN_DB.
function markHydrated() { storeHydrated = true; }
useApp.persist.onFinishHydration(markHydrated);
if (useApp.persist.hasHydrated()) markHydrated();

// Rulează hidratarea mesajelor după ce persist-ul (storage async) a terminat rehidratarea.
if (MESSAGES_IN_DB) {
  useApp.persist.onFinishHydration(() => { void hydrateMessages(); });
  if (useApp.persist.hasHydrated()) void hydrateMessages();
}
