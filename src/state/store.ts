/**
 * State global (zustand) — ORCHESTRATOR (Faza 3.1): compune slice-urile auth/chat/settings
 * (src/state/slices/, tipuri în types.ts) + infra de persistență criptată (encStorage debounce)
 * + hidratarea mesajelor M1. Nu ține NICIODATĂ chei private — acelea sunt doar în SecureStorage.
 */
import { AppState as RNAppState } from "react-native";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { Message } from "../data/mockData";
import { dbGetItem, dbSetItem, dbRemoveItem, DB_KEYS } from "../storage/db";
import {
  syncConv as dbSyncConv, loadAllMessages, isMigrated, setMigrated, MESSAGES_IN_DB,
  appendMessage as msgAppend, // pt flush extras + migrare în hydrateMessages
} from "../storage/messages";
import { setMessagesReady, setSuspendMsgSync } from "./messagePersistence";
import { AppState } from "./types";
import { createAuthSlice } from "./slices/authSlice";
import { createSettingsSlice } from "./slices/settingsSlice";
import { createChatSlice } from "./slices/chatSlice";

export type { ThemeName } from "./types"; // re-export pt importurile existente din UI

// Magazin persistent CRIPTAT la repaus pentru zustand (Faza 1).
// M5 — scriere debounce-uită: rafalele (bife ✓→✓✓, mesaje rapide) se contopesc într-o SINGURĂ
// criptare+scriere în loc de una per eveniment (store-ul e un blob mare, recriptat integral).
const PERSIST_DELAY = 500;
const pendingWrites = new Map<string, string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// GUARD CRITIC: nu scrie nimic în DB până store-ul nu s-a hidratat din DB. Altfel un setter
// timpuriu (montarea unei componente cu starea default conversations=[]) ar suprascrie DB-ul cu
// starea goală ÎNAINTE ca hidratarea să termine = pierdere de date.
let storeHydrated = false;

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

export const useApp = create<AppState>()(
  persist(
    (...a) => ({
      ...createAuthSlice(...a),
      ...createSettingsSlice(...a),
      ...createChatSlice(...a),
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

/**
 * M1 — la pornire: prima dată migrează mesajele din blobul vechi (deja în memorie) în SQLite;
 * apoi încarcă mesajele din SQLite în store. Apelat din _layout. Vezi messagePersistence pt
 * guard-urile anti-pierdere (messagesReady/suspendMsgSync) și write-through-ul O(1).
 */
export async function hydrateMessages(): Promise<void> {
  if (!MESSAGES_IN_DB) return;
  if (!(await isMigrated())) {
    // Prima rulare cu M1: blobul vechi (deja hidratat) încă are mesajele → mută-le în SQLite.
    const convs = useApp.getState().conversations;
    for (const c of convs) if (c.messages.length) await dbSyncConv(c.id, c.messages);
    await setMigrated();
    setMessagesReady(true); // de-acum write-through-ul O(1) e sigur (mesajele sunt în SQLite)
    setSuspendMsgSync(false);
    return;
  }
  const byConv = await loadAllMessages();
  // merge defensiv: păstrează mesajele sosite în fereastra de pornire (cât messagesReady era
  // false → scrierea lor a fost gated) și RE-PERSISTĂ-le în SQLite (flush extras), ca să nu se
  // piardă dacă app-ul se închide după hidratare. Calculăm înainte de a activa scrierile.
  const cur = useApp.getState().conversations;
  const extras: { convId: string; m: Message }[] = [];
  const next = cur.map((c) => {
    const loaded = byConv[c.id];
    if (!loaded) return c;                       // nimic în DB pt conv → păstrează memoria
    if (!c.messages.length) return { ...c, messages: loaded };
    const ids = new Set(loaded.map((m) => m.id));
    const extra = c.messages.filter((m) => !ids.has(m.id));
    if (!extra.length) return { ...c, messages: loaded };
    for (const m of extra) extras.push({ convId: c.id, m });
    return { ...c, messages: [...loaded, ...extra].sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0)) };
  });
  // Activează scrierile ÎNAINTE de setState, ca mutațiile ulterioare să se persiste.
  setMessagesReady(true);
  setSuspendMsgSync(false);
  useApp.setState({ conversations: next });
  for (const { convId, m } of extras) void msgAppend(convId, m); // persistă arrivile din fereastra de pornire
}

// Deblochează scrierile blobului DOAR după ce hidratarea din DB a terminat (anti-pierdere date,
// vezi guard-ul din encStorage.setItem). Necondiționat de MESSAGES_IN_DB.
function markHydrated() { storeHydrated = true; }
useApp.persist.onFinishHydration(markHydrated);
if (useApp.persist.hasHydrated()) markHydrated();

// Rulează hidratarea mesajelor după ce persist-ul (storage async) a terminat rehidratarea.
if (MESSAGES_IN_DB) {
  useApp.persist.onFinishHydration(() => { void hydrateMessages(); });
  if (useApp.persist.hasHydrated()) void hydrateMessages();
}
