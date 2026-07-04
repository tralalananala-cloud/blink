/**
 * M1 — write-through O(1) al mesajelor în SQLite + guard-urile anti-pierdere (Faza 2.2),
 * extras din store.ts (Faza 3.1). Fiecare mutație de mesaj scrie DOAR rândul atins (vs vechiul
 * syncConv = DELETE+INSERT toată conversația). Concern separat de reducere → store.ts/slices
 * doar cheamă `persist*`; aici trăiesc guard-urile.
 *
 * Guard-uri (anti-pierdere date — validat pe device 2026-06-28):
 *  • messagesReady: false până hydrateMessages() reîncarcă mesajele din SQLite. Cât e false,
 *    scrierile sunt gated (altfel conv-urile hidratate cu messages:[] din blob ar scrie array gol).
 *  • suspendMsgSync: ridicat de clearMessagesFromMemory (igienă RAM) ca golirea intenționată a
 *    RAM-ului să NU se propage; coborât la re-hidratare. Ce sosește gated rămâne în state și e
 *    re-persistat de hydrateMessages (merge defensiv + flush extras).
 * Ștergerile sunt idempotente → fără gate (sigure oricând).
 */
import { Message, MsgStatus } from "../data/mockData";
import {
  MESSAGES_IN_DB,
  appendMessage as msgAppend, updateMessage as msgUpdate, setMessageStatus as msgSetStatus,
  deleteMessage as msgDelete, deleteConvMessages,
} from "../storage/messages";

let messagesReady = false;
let suspendMsgSync = false;

/** hydrateMessages a terminat → deblochează scrierile O(1). */
export function setMessagesReady(v: boolean) { messagesReady = v; }
/** clearMessagesFromMemory (igienă RAM) ridică suspendarea; re-hidratarea o coboară. */
export function setSuspendMsgSync(v: boolean) { suspendMsgSync = v; }

const canPersistMsg = () => MESSAGES_IN_DB && messagesReady && !suspendMsgSync;

export function persistAppend(convId: string, m: Message) { if (canPersistMsg()) void msgAppend(convId, m); }
export function persistStatus(convId: string, id: string, status: MsgStatus) { if (canPersistMsg()) void msgSetStatus(convId, id, status); }
export function persistUpdate(convId: string, id: string, mut: (m: Message) => Message) { if (canPersistMsg()) void msgUpdate(convId, id, mut); }
export function persistDelete(id: string) { if (MESSAGES_IN_DB) void msgDelete(id); }
export function persistConvDelete(convId: string) { if (MESSAGES_IN_DB) void deleteConvMessages(convId); }
