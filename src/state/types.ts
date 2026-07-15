/**
 * Tipuri partajate ale store-ului (Faza 3.1) — extrase din store.ts ca slice-urile
 * (auth/chat/settings) să le importe fără import circular cu store.ts.
 * AppState = AuthSlice & ChatSlice & SettingsSlice (un singur store compus).
 */
import { Identity } from "../crypto/types";
import { TransportStatus } from "../transport/types";
import { GroupAct } from "../messaging/codec";
import { Attachment, Contact, Conversation, MsgStatus } from "../data/mockData";
import { StateCreator } from "zustand";

export type ThemeName = "cipher" | "messenger" | "telegram" | "abyss" | "nebula";

export interface Settings {
  themeName: ThemeName;
  transportMode: TransportStatus["mode"];
  sealedSender: boolean;
  screenshotBlocker: boolean;
  selfHostedRelay: boolean;
  biometricLock: boolean;
  notifications: boolean;
  /**
   * Arată expeditorul și textul mesajului în notificare. IMPLICIT OPRIT: notificarea se vede pe
   * ecranul blocat, deci previzualizarea ar scrie conținutul în clar pentru oricine se uită la
   * telefon — exact ce contrazice restul app-ului (FLAG_SECURE, parole per-conversație).
   * Oprit → „Mesaj nou criptat”, la fel ca notificarea de push (releul oricum nu poate citi nimic).
   */
  notifPreview: boolean;
  /** Numele/pseudonimul tău — apare la ceilalți când le scrii / te adaugă. */
  profileName: string;
  /** Transport Reticulum (experimental): rutează mesajele descentralizat prin gateway. */
  reticulumEnabled: boolean;
  /** Adresa gateway-ului Reticulum (https). Gol → folosește valoarea din build (de obicei gol). */
  reticulumGateway: string;
  /**
   * Ține polling-ul Reticulum viu și cu app-ul închis (serviciu de foreground → contextul JS
   * rămâne viu → polling-ul continuă + notificări). Fără el, mesajele Reticulum ajung doar cât
   * ții Blink deschis. IMPLICIT OPRIT: costă o notificare permanentă + baterie (rețea trează).
   */
  reticulumBackground: boolean;
  /** Mesh Bluetooth (experimental): livrare directă telefon↔telefon în proximitate (BLE). */
  bleMeshEnabled: boolean;
  /**
   * Ține mesh-ul viu și cu app-ul închis (serviciu de foreground + notificare permanentă).
   * Oprit → mesh-ul merge DOAR cât ții app-ul deschis; în buzunar consumul e zero, dar nu poți
   * primi nimic prin Bluetooth. Ăsta e compromisul dintre autonomie și „chiar funcționează”.
   */
  bleMeshBackground: boolean;
}

export interface AuthSlice {
  onboarded: boolean;
  identity: Identity | null;
  setOnboarded: (v: boolean) => void;
  setIdentity: (id: Identity) => void;
}

export interface ChatSlice {
  conversations: Conversation[];
  /** Adaugă un mesaj; întoarce id-ul lui (pt corelarea bifelor). */
  appendMessage: (
    convId: string,
    text: string,
    fromMe: boolean,
    attachment?: Attachment,
    meta?: { id?: string; remoteId?: string; status?: MsgStatus; sender?: string; senderName?: string },
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
  /** Deschide (sau creează) o conversație 1:1 cu un contact; întoarce id-ul. */
  openDirect: (contact: Contact) => string;
  /** Mesaj primit prin releu (decriptat): găsește/creează conversația + notificare. */
  receiveMessage: (fromDid: string, text: string, remoteId?: string, attachment?: Attachment, senderName?: string) => void;
  /** Creează un grup cu membrii dați (tu = admin); întoarce gid-ul (= id-ul conversației). */
  createGroup: (name: string, memberDids: string[]) => string;
  /** Mesaj de grup primit (gt, decriptat): găsește/creează grupul după gid + notificare. */
  receiveGroupMessage: (
    fromDid: string, gid: string, text: string,
    remoteId?: string, attachment?: Attachment, senderName?: string, gname?: string,
  ) => void;
  /** Aplică un control de membership (gc) primit: create/add/remove doar de la admin, leave de la oricine. */
  applyGroupCtl: (fromDid: string, gc: { gid: string; act: GroupAct; members?: string[]; name?: string }) => void;
  /** Bife pe mesajele proprii de grup (statusul agregat îl calculează stratul de trimitere). */
  markGroupMsgStatus: (gid: string, msgId: string, status: MsgStatus) => void;
  clearMessagesFromMemory: () => void;
  wipe: () => void;
}

export interface SettingsSlice {
  contacts: Contact[];
  blocked: string[];
  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  /** Adaugă un prieten după DID; întoarce false dacă există deja sau e blocat. */
  addContact: (name: string, did: string) => boolean;
  /** Șterge un contact din listă (nu-l blochează). */
  deleteContact: (did: string) => void;
  /** Blochează un contact: șterge conversația + contactul + îl marchează blocat. */
  blockContact: (convId: string) => void;
}

export type AppState = AuthSlice & ChatSlice & SettingsSlice;

/** Slice creator tipat pt store-ul cu persist middleware (Faza 3.1). */
export type Slice<T> = StateCreator<AppState, [["zustand/persist", unknown]], [], T>;
