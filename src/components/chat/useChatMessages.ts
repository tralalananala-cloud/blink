/** Hook cu STAREA mesajelor (Faza 3.3 finalizare) — text/editing + trimitere/editare/ștergere.
 *  Extras din chat/[id].tsx; logica byte-identică. Apelat ÎNAINTE de orice early return (reguli hooks);
 *  deliver guard-ează intern conv undefined. Efectele (read-receipt/burn/session) rămân în component. */
import { useState } from "react";
import { Alert, FlatList, TextInput } from "react-native";
import * as Haptics from "expo-haptics";
import { useApp } from "../../state/store";
import { engine } from "../../crypto";
import { relay } from "../../messaging/relay";
import { SessionInfo } from "../../crypto/types";
import { Attachment, Conversation, Message } from "../../data/mockData";

type Deps = {
  listRef: React.RefObject<FlatList>;
  inputRef: React.RefObject<TextInput>;
  setEmoji: (v: boolean) => void;
  setMenuMsg: (m: Message | null) => void;
  setSession: (s: SessionInfo | null) => void;
};

export function useChatMessages(conv: Conversation | undefined, deps: Deps) {
  const append = useApp((s) => s.appendMessage);
  const editMessage = useApp((s) => s.editMessage);
  const deleteMessage = useApp((s) => s.deleteMessage);
  const markStatus = useApp((s) => s.markMsgStatus);
  const [text, setText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  async function deliver(plaintext: string, attachment?: Attachment) {
    if (!conv) return;
    const id = append(conv.id, plaintext, true, attachment); // afișează imediat
    setTimeout(() => deps.listRef.current?.scrollToEnd({ animated: true }), 60);
    // trimite prin releu (E2E real). Grupurile = fază ulterioară.
    if (!conv.group && plaintext.trim()) {
      await relay.sendText(conv.did, plaintext, id);
      if (engine.hasSession(conv.did)) deps.setSession(await engine.getSession(conv.did));
    } else if (!conv.group && attachment) {
      // media criptată pe bucăți (Faza 3)
      const res = await relay.sendMedia(conv.did, attachment, id);
      if (!res.ok) {
        markStatus(conv.did, id, "sent"); // rămâne afișat local
        if (res.reason === "too-big") Alert.alert("Fișier prea mare", "Maxim 8 MB prin rețea deocamdată.");
      }
    } else {
      // grupuri încă nu trec prin rețea → marchează local ca trimis
      markStatus(conv.did, id, "sent");
    }
  }

  async function sendText() {
    if (!text.trim() || !conv) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    const t0 = text.trim();
    setText("");
    deps.setEmoji(false);
    if (editingId) {
      editMessage(conv.id, editingId, t0);
      if (!conv.group) relay.sendEdit(conv.did, editingId, t0).catch(() => {}); // editează și la celălalt
      setEditingId(null);
      return;
    }
    await deliver(t0);
  }

  function startEdit(m: Message) {
    deps.setMenuMsg(null);
    setEditingId(m.id);
    setText(m.text);
    deps.setEmoji(false);
    setTimeout(() => deps.inputRef.current?.focus(), 60);
  }
  function cancelEdit() { setEditingId(null); setText(""); }

  function deleteForMe(m: Message) {
    deps.setMenuMsg(null);
    if (conv) deleteMessage(conv.id, m.id);
  }
  function deleteForAll(m: Message) {
    deps.setMenuMsg(null);
    if (!conv) return;
    if (!conv.group) relay.sendDeleteMsg(conv.did, m.id).catch(() => {}); // șterge și la celălalt
    deleteMessage(conv.id, m.id);
  }

  return { text, setText, editingId, deliver, sendText, startEdit, cancelEdit, deleteForMe, deleteForAll };
}
