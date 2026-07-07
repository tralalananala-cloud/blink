/** Date demo pentru UI. Niciun continut real, niciun apel de retea. */

export type MsgStatus = "sending" | "sent" | "relayed" | "delivered" | "read" | "received";

export type AttachmentKind = "image" | "video" | "file" | "voice" | "circle";

export interface Attachment {
  kind: AttachmentKind;
  uri: string;
  name?: string; // pentru fisiere
  size?: number; // bytes
  durationMs?: number; // pentru voice / video / circle
  width?: number;
  height?: number;
}

export interface Message {
  id: string;
  text: string;
  fromMe: boolean;
  ts: number;
  status: MsgStatus;
  attachment?: Attachment;
  edited?: boolean;
  readAt?: number; // când a fost citit (pt auto-ștergere)
  remoteId?: string; // id-ul mesajului la EXPEDITOR (pe mesajele primite) — pt confirmare de citire
  readAckSent?: boolean; // am trimis deja confirmarea „citit" pentru acest mesaj primit
  sender?: string; // DID-ul expeditorului (doar în grupuri — la 1:1 e implicit conv.did)
  senderName?: string; // numele afișat al expeditorului (grupuri: eticheta de pe bublă)
}

export interface Conversation {
  id: string;
  name: string;
  did: string;
  verified: boolean;
  unread: number;
  group: boolean;
  members?: string[]; // DID-urile TUTUROR membrilor, inclusiv tu (doar la grupuri)
  admin?: string; // DID-ul creatorului = admin unic v1 (doar el face add/remove)
  ephemeral?: string; // ex. "24h"
  locked?: boolean; // are parolă (hash în SecureStore)
  burnAfterReadMs?: number; // auto-ștergere după citire (undefined = oprit)
  needsRepair?: boolean; // B2 — contactul și-a resetat identitatea → trebuie re-adăugat prin QR
  lastTs: number;
  messages: Message[];
}

const now = Date.now();
const min = 60_000;

declare const __DEV__: boolean;

export function seedConversations(): Conversation[] {
  // Date demo DOAR în dezvoltare (Expo Go). În release/producție: gol.
  if (typeof __DEV__ !== "undefined" && !__DEV__) return [];
  return [
    {
      id: "ion",
      name: "Ion Cipher",
      did: "did:key:z6MkrA1b2c3d4e5f6g7h8i9j0k",
      verified: true,
      unread: 2,
      group: false,
      ephemeral: "24h",
      lastTs: now - 2 * min,
      messages: [
        { id: "ion-0", text: "Salut! Ai primit cheia nouă?", fromMe: false, ts: now - 9 * min, status: "received" },
        { id: "ion-1", text: "Da, verificată prin QR. ✅", fromMe: true, ts: now - 8 * min, status: "delivered" },
        { id: "ion-2", text: "Perfect. Mergem pe mesh diseară?", fromMe: false, ts: now - 2 * min, status: "received" },
      ],
    },
    {
      id: "cell",
      name: "Celula 7",
      did: "did:key:z6MkGroupX9y8z7w6v5u4t3s2r1",
      verified: false,
      unread: 0,
      group: true,
      lastTs: now - 40 * min,
      messages: [
        { id: "cell-0", text: "Întâlnire mutată. Detalii pe canalul efemer.", fromMe: false, ts: now - 40 * min, status: "received" },
      ],
    },
    {
      id: "maya",
      name: "Maya",
      did: "did:key:z6MkpQrStUvWxYz1234567890ab",
      verified: true,
      unread: 0,
      group: false,
      lastTs: now - 3 * 60 * min,
      messages: [
        { id: "maya-0", text: "Trimit fișierul criptat acum.", fromMe: true, ts: now - 3 * 60 * min, status: "sent" },
      ],
    },
  ];
}

export interface Contact {
  name: string;
  did: string;
  verified: boolean;
  status: "direct" | "relay" | "offline";
}

export function seedContacts(): Contact[] {
  if (typeof __DEV__ !== "undefined" && !__DEV__) return [];
  return [
    { name: "Ion Cipher", did: "did:key:z6MkrA1b2c3d4e5f6g7h8i9j0k", verified: true, status: "direct" },
    { name: "Maya", did: "did:key:z6MkpQrStUvWxYz1234567890ab", verified: true, status: "relay" },
    { name: "Robert", did: "did:key:z6MkbQ1w2e3r4t5y6u7i8o9p0aa", verified: false, status: "offline" },
    { name: "Nadia", did: "did:key:z6MknZ9x8c7v6b5n4m3l2k1j0hh", verified: false, status: "relay" },
  ];
}

/** Validare minimă de DID (did:key:z...). Acceptă alfabetul real generat de app. */
export function isValidDid(s: string): boolean {
  return /^did:key:z[A-Za-z0-9]{16,}$/.test(s.trim());
}
