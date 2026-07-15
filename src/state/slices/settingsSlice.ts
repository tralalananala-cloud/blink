/** Slice setări + contacte + blocați (Faza 3.1). */
import { SettingsSlice, Slice } from "../types";
import { transport } from "../../transport/mockTransport";
import { persistConvDelete } from "../messagePersistence";

export const createSettingsSlice: Slice<SettingsSlice> = (set, get) => ({
  contacts: [],
  blocked: [],
  settings: {
    themeName: "cipher",
    transportMode: "p2p",
    sealedSender: true,
    screenshotBlocker: true,
    selfHostedRelay: false,
    biometricLock: false,
    notifications: true,
    notifPreview: false, // conținutul NU apare pe ecranul blocat până nu ceri tu explicit
    profileName: "",
    reticulumEnabled: false,
    // gateway-ul public Blink pre-completat — userul doar pornește toggle-ul (poate pune propriul gateway)
    reticulumGateway: "https://blink-gw.tralalananala.workers.dev",
    reticulumBackground: false, // opt-in: serviciu de fundal + notificare permanentă (cost baterie)
    bleMeshEnabled: false,
    bleMeshBackground: true, // dacă pornești mesh-ul, aștepți să și primești mesaje — altfel n-are rost

  },

  updateSettings: (patch) =>
    set((s) => {
      const settings = { ...s.settings, ...patch };
      if (patch.transportMode) transport.setMode(patch.transportMode);
      return { settings };
    }),

  addContact: (name, did) => {
    const d = did.trim();
    const st = get();
    if (st.blocked.includes(d)) return false;
    if (st.contacts.some((c) => c.did === d)) return false;
    set((s) => ({
      contacts: [...s.contacts, { name: name.trim() || d.slice(0, 16), did: d, verified: false, status: "relay" }],
    }));
    return true;
  },

  deleteContact: (did) => set((s) => ({ contacts: s.contacts.filter((c) => c.did !== did) })),

  // Blochează un contact: scoate conversația + contactul + îl marchează blocat (+ șterge mesajele lui din SQLite).
  blockContact: (convId) => {
    set((s) => {
      const conv = s.conversations.find((c) => c.id === convId);
      const did = conv?.did;
      return {
        conversations: s.conversations.filter((c) => c.id !== convId),
        contacts: did ? s.contacts.filter((c) => c.did !== did) : s.contacts,
        blocked: did && !s.blocked.includes(did) ? [...s.blocked, did] : s.blocked,
      };
    });
    persistConvDelete(convId);
  },
});
