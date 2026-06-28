import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "../../src/components/Icon";
import * as Haptics from "expo-haptics";
import { MeshBackground } from "../../src/components/MeshBackground";
import { Avatar } from "../../src/components/Avatar";
import { VerifiedBadge } from "../../src/components/Badges";
import { MessageBubble } from "../../src/components/MessageBubble";
import { EmojiPicker } from "../../src/components/EmojiPicker";
import { radius, space } from "../../src/theme/tokens";
import { fonts } from "../../src/theme/typography";
import { useTheme, useType } from "../../src/theme/ThemeProvider";
import { useI18n, format } from "../../src/i18n";
import { useApp } from "../../src/state/store";
import { engine } from "../../src/crypto";
import { relay } from "../../src/messaging/relay";
import { SessionInfo } from "../../src/crypto/types";
import { Attachment, Message } from "../../src/data/mockData";
import { pickFile, pickImage, pickVideo, takePhoto, VoiceRecorder } from "../../src/media/actions";
import { dismissConversation } from "../../src/notify";
import { callManager } from "../../src/calls/webrtc";
import { PasscodeModal } from "../../src/components/PasscodeModal";
import { VerifySafetyModal } from "../../src/components/VerifySafetyModal";
import { clearConvPasscode, hasConvPasscode, setConvPasscode, verifyConvPasscode } from "../../src/security/lock";

const BURN_OPTIONS: { key: string; min: number; ms?: number }[] = [
  { key: "off", min: 0, ms: undefined },
  { key: "1", min: 1, ms: 60_000 },
  { key: "5", min: 5, ms: 5 * 60_000 },
  { key: "10", min: 10, ms: 10 * 60_000 },
  { key: "30", min: 30, ms: 30 * 60_000 },
  { key: "60", min: 60, ms: 60 * 60_000 },
  { key: "6h", min: 360, ms: 6 * 3600_000 },
  { key: "12h", min: 720, ms: 12 * 3600_000 },
];
function burnLabel(o: { key: string; min: number }, off: string): string {
  if (o.key === "off") return off;
  if (o.min < 60) return `${o.min} min`;
  return `${o.min / 60} h`;
}

const ATTACH_ACTIONS = [
  { key: "image", glyph: "🖼️", label: "Poză", run: pickImage },
  { key: "photo", glyph: "📷", label: "Fotografiază", run: takePhoto },
  { key: "video", glyph: "🎞️", label: "Video", run: pickVideo },
  { key: "file", glyph: "📎", label: "Fișier", run: pickFile },
] as const;

export default function Conversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { colors, family } = useTheme();
  const type = useType();
  const insets = useSafeAreaInsets();
  const conv = useApp((s) => s.conversations.find((c) => c.id === id));
  const append = useApp((s) => s.appendMessage);
  const editMessage = useApp((s) => s.editMessage);
  const deleteMessage = useApp((s) => s.deleteMessage);
  const setConvLocked = useApp((s) => s.setConvLocked);
  const setBurnTimer = useApp((s) => s.setBurnTimer);
  const markRead = useApp((s) => s.markRead);
  const clearUnread = useApp((s) => s.clearUnread);
  const markVerified = useApp((s) => s.markVerified);
  const markStatus = useApp((s) => s.markMsgStatus);
  const burnSweep = useApp((s) => s.burnSweep);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [lockMode, setLockMode] = useState<null | "set" | "verify">(null);
  const [unlocked, setUnlocked] = useState(true);
  const [text, setText] = useState("");
  const [menuMsg, setMenuMsg] = useState<Message | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [keyChanged, setKeyChanged] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [attach, setAttach] = useState(false);
  const [recording, setRecording] = useState(false);
  const listRef = useRef<FlatList>(null);
  // true cât timp utilizatorul e jos de tot; doar atunci auto-derulăm la fund (la mesaj nou /
  // deschiderea tastaturii). Altfel, dacă a derulat în sus să citească istoricul, NU-l mai smucim.
  const atBottomRef = useRef(true);
  const recRef = useRef<VoiceRecorder | null>(null);

  useEffect(() => {
    if (!conv) return;
    engine.getSession(conv.did).then(setSession);
    setKeyChanged(!conv.verified);
    // blocare conversație — sursa de adevăr e SecureStore (persistă peste restart),
    // și cere parola la FIECARE intrare în conversație.
    let active = true;
    hasConvPasscode(conv.id).then((has) => {
      if (!active) return;
      if (has) { setConvLocked(conv.id, true); setUnlocked(false); setLockMode("verify"); }
      else setUnlocked(true);
    });
    return () => { active = false; };
  }, [conv?.id]);

  // confirmări de citire (✓✓ colorat la expeditor): la deschidere + la mesaje noi
  useEffect(() => {
    if (!conv || !unlocked || conv.group) return;
    relay.sendReadReceipts(conv.did);
  }, [conv?.id, unlocked, conv?.messages.length]);

  // B1 — la deschiderea conversației, șterge notificările ei din bară (orice conversație) + resetează badge-ul de necitite
  useEffect(() => {
    if (conv && unlocked) {
      dismissConversation(conv.id);
      clearUnread(conv.id);
    }
  }, [conv?.id, unlocked]);

  // auto-ștergere după citire: marchează citit la deschidere + curăță periodic
  useEffect(() => {
    if (!conv || !unlocked || !conv.burnAfterReadMs) return;
    markRead(conv.id);
    burnSweep();
    const iv = setInterval(burnSweep, 4000);
    return () => clearInterval(iv);
  }, [conv?.id, unlocked, conv?.burnAfterReadMs]);

  if (!conv) {
    return (
      <MeshBackground>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={type.bodyMuted}>—</Text>
        </View>
      </MeshBackground>
    );
  }

  async function deliver(plaintext: string, attachment?: Attachment) {
    if (!conv) return;
    const id = append(conv.id, plaintext, true, attachment); // afișează imediat
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
    // trimite prin releu (E2E real). Grupurile = fază ulterioară.
    if (!conv.group && plaintext.trim()) {
      await relay.sendText(conv.did, plaintext, id);
      if (engine.hasSession(conv.did)) setSession(await engine.getSession(conv.did));
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
    setEmoji(false);
    if (editingId) {
      editMessage(conv.id, editingId, t0);
      if (!conv.group) relay.sendEdit(conv.did, editingId, t0).catch(() => {}); // editează și la celălalt
      setEditingId(null);
      return;
    }
    await deliver(t0);
  }

  function startEdit(m: Message) {
    setMenuMsg(null);
    setEditingId(m.id);
    setText(m.text);
    setEmoji(false);
    setTimeout(() => inputRef.current?.focus(), 60);
  }

  function deleteForMe(m: Message) {
    setMenuMsg(null);
    if (conv) deleteMessage(conv.id, m.id);
  }
  function deleteForAll(m: Message) {
    setMenuMsg(null);
    if (!conv) return;
    if (!conv.group) relay.sendDeleteMsg(conv.did, m.id).catch(() => {}); // șterge și la celălalt
    deleteMessage(conv.id, m.id);
  }

  async function runAttach(run: () => Promise<Attachment | null>) {
    setAttach(false);
    const a = await run();
    if (a) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      await deliver("", a);
    }
  }

  async function toggleVoice() {
    if (!recording) {
      const r = new VoiceRecorder();
      const ok = await r.start();
      if (!ok) return;
      recRef.current = r;
      setRecording(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    } else {
      const a = await recRef.current?.stop();
      recRef.current = null;
      setRecording(false);
      if (a) await deliver("", a);
    }
  }

  const hasText = text.trim().length > 0;

  return (
    <MeshBackground>
      <View style={{ paddingTop: insets.top, flex: 1 }}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Icon name={family === "cipher" ? "chevron-back" : "arrow-back"} size={26} color={family === "cipher" ? colors.primary : colors.textPrimary} />
          </Pressable>
          <Pressable onPress={() => setOptionsOpen(true)} style={styles.headerCenter}>
            <Avatar name={conv.name} did={conv.did} size={38} group={conv.group} />
            <View style={{ flex: 1 }}>
              <View style={styles.nameLine}>
                <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>{conv.name}</Text>
                {conv.verified ? <VerifiedBadge verified /> : null}
                {conv.locked ? <Icon name="lock-closed" size={13} color={colors.textMuted} /> : null}
              </View>
              {conv.group ? (
                <Text style={[styles.ratchet, { color: colors.warning }]}>
                  👥 {format(t.friends.membersCount, { n: conv.members?.length ?? 0 })} · demo
                </Text>
              ) : conv.burnAfterReadMs ? (
                <Text style={[styles.ratchet, { color: colors.accent }]}>
                  ⏳ {BURN_OPTIONS.find((o) => o.ms === conv.burnAfterReadMs) ? burnLabel(BURN_OPTIONS.find((o) => o.ms === conv.burnAfterReadMs)!, t.lock.off) : ""} · {t.lock.disappearing.toLowerCase()}
                </Text>
              ) : session ? (
                <Text style={[styles.ratchet, { color: colors.secure }]}>
                  🔒 {format(t.conversation.ratchetSecured, { n: session.ratchetStep })}
                  {conv.ephemeral ? `  ·  ⏳ ${format(t.conversation.ephemeralOn, { d: conv.ephemeral })}` : ""}
                </Text>
              ) : null}
            </View>
          </Pressable>
          <View style={styles.headerIcons}>
            {/* Apel audio/video — doar 1:1 (Faza 5 WebRTC) */}
            {!conv.group ? (
              <>
                <Pressable hitSlop={8} onPress={() => callManager.startCall(conv.did, false)}>
                  <Icon name="call" size={22} color={family === "cipher" ? colors.accent : colors.primary} />
                </Pressable>
                <Pressable hitSlop={8} onPress={() => callManager.startCall(conv.did, true)}>
                  <Icon name="videocam" size={24} color={family === "cipher" ? colors.accent : colors.primary} />
                </Pressable>
              </>
            ) : null}
            {!conv.group ? (
              <Pressable hitSlop={8} onPress={() => setVerifyOpen(true)}>
                <Icon name="shield" size={22} color={conv.verified ? colors.secure : (family === "cipher" ? colors.accent : colors.primary)} />
              </Pressable>
            ) : family === "telegram" ? (
              <Icon name="ellipsis-vertical" size={22} color={colors.textPrimary} />
            ) : null}
          </View>
        </View>

        {!unlocked ? (
          <View style={styles.lockedArea}>
            <Icon name="lock-closed" size={52} color={colors.textMuted} />
            <Text style={[type.h3, { marginTop: space.lg }]}>{t.lock.unlockConv}</Text>
            <Text style={[type.bodyMuted, { textAlign: "center", marginTop: 4 }]}>{t.lock.unlockConvBody}</Text>
            <Pressable onPress={() => setLockMode("verify")} style={[styles.unlockBtn, { backgroundColor: colors.primary }]}>
              <Text style={{ color: colors.onPrimary, fontFamily: fonts.bodySemibold, fontSize: 15 }}>{t.common.continue}</Text>
            </Pressable>
          </View>
        ) : (
        <>
        {keyChanged ? (
          <View style={[styles.keyAlert, { backgroundColor: colors.glowDanger, borderColor: colors.warning }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.keyAlertTitle, { color: colors.warning }]}>{t.conversation.keyChangedTitle}</Text>
              <Text style={[styles.keyAlertBody, { color: colors.textSecondary }]}>{t.conversation.keyChangedBody}</Text>
            </View>
            <Pressable onPress={() => { setKeyChanged(false); setVerifyOpen(true); }} style={[styles.verifyBtn, { borderColor: colors.warning }]}>
              <Text style={[styles.verifyText, { color: colors.warning }]}>{t.conversation.verify}</Text>
            </Pressable>
          </View>
        ) : null}

        {conv.needsRepair ? (
          <View style={[styles.keyAlert, { backgroundColor: colors.glowDanger, borderColor: colors.warning }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.keyAlertTitle, { color: colors.warning }]}>{t.conversation.repairTitle}</Text>
              <Text style={[styles.keyAlertBody, { color: colors.textSecondary }]}>{t.conversation.repairBody}</Text>
            </View>
          </View>
        ) : null}

        {/* Nudge de verificare: împinge userul să confirme identitatea contactului (anti-impersonare).
            Discret, tappable → deschide safety number. Doar 1:1, neverificat, cu sesiune, fără alte alerte. */}
        {!conv.group && !conv.verified && session && !keyChanged && !conv.needsRepair && unlocked ? (
          <Pressable onPress={() => setVerifyOpen(true)} style={[styles.verifyNudge, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Icon name="shield" size={15} color={colors.accent} />
            <Text style={[styles.verifyNudgeText, { color: colors.textSecondary }]} numberOfLines={1}>{t.conversation.unverifiedNudge}</Text>
          </Pressable>
        ) : null}

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <FlatList
            ref={listRef}
            data={conv.messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <MessageBubble msg={item} onLongPress={setMenuMsg} />}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
              atBottomRef.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
            }}
            scrollEventThrottle={16}
            onContentSizeChange={() => { if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: false }); }}
            initialNumToRender={15}
            maxToRenderPerBatch={10}
            windowSize={11}
            removeClippedSubviews
          />

          {/* meniu atașamente */}
          {attach ? (
            <View style={[styles.attachMenu, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
              {ATTACH_ACTIONS.map((a) => (
                <Pressable key={a.key} style={styles.attachItem} onPress={() => runAttach(a.run)}>
                  <View style={[styles.attachIcon, { backgroundColor: colors.surface }]}>
                    <Text style={{ fontSize: 24 }}>{a.glyph}</Text>
                  </View>
                  <Text style={[styles.attachLabel, { color: colors.textSecondary }]}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* banner editare */}
          {editingId ? (
            <View style={[styles.editBanner, { backgroundColor: colors.bgRaised, borderTopColor: colors.border }]}>
              <Icon name="create" size={16} color={colors.accent} />
              <Text style={[styles.editText, { color: colors.textSecondary }]} numberOfLines={1}>{t.conversation.editing}</Text>
              <Pressable hitSlop={10} onPress={() => { setEditingId(null); setText(""); }}>
                <Text style={[styles.editClose, { color: colors.textMuted }]}>✕</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Composer — iconițe per familie de temă */}
          <View style={[styles.composer, { paddingBottom: emoji ? space.sm : insets.bottom + space.sm, backgroundColor: colors.bgRaised, borderTopColor: colors.border }]}>
            {/* butoane STÂNGA */}
            {family === "messenger" ? (
              <Pressable onPress={() => { setAttach((v) => !v); setEmoji(false); }} hitSlop={8} style={[styles.iconBtn, styles.camBtn, { backgroundColor: colors.primary }]}>
                <Icon name="camera" size={20} color={colors.onPrimary} />
              </Pressable>
            ) : family === "telegram" ? (
              <Pressable onPress={() => { setEmoji((v) => !v); setAttach(false); }} hitSlop={8} style={styles.iconBtn}>
                <Icon name={emoji ? "chatbox-ellipses-outline" : "happy-outline"} size={24} color={colors.textMuted} />
              </Pressable>
            ) : (
              <>
                <Pressable onPress={() => { setAttach((v) => !v); setEmoji(false); }} hitSlop={8} style={styles.iconBtn}>
                  <Icon name="add-circle-outline" size={26} color={colors.accent} />
                </Pressable>
                <Pressable onPress={() => { setEmoji((v) => !v); setAttach(false); }} hitSlop={8} style={styles.iconBtn}>
                  <Icon name={emoji ? "keypad-outline" : "happy-outline"} size={24} color={colors.textSecondary} />
                </Pressable>
              </>
            )}

            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={setText}
              onFocus={() => setEmoji(false)}
              placeholder={recording ? "● …" : t.conversation.placeholder}
              placeholderTextColor={recording ? colors.danger : colors.textMuted}
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary }]}
              multiline
            />

            {/* butoane DREAPTA */}
            {family === "telegram" && !hasText ? (
              <Pressable onPress={() => { setAttach((v) => !v); setEmoji(false); }} hitSlop={8} style={styles.iconBtn}>
                <Icon name="attach" size={26} color={colors.textMuted} />
              </Pressable>
            ) : family === "messenger" && !hasText ? (
              <Pressable onPress={() => { setEmoji((v) => !v); setAttach(false); }} hitSlop={8} style={styles.iconBtn}>
                <Icon name={emoji ? "keypad-outline" : "happy-outline"} size={24} color={colors.primary} />
              </Pressable>
            ) : null}

            {hasText ? (
              <Pressable onPress={sendText} style={[styles.sendBtn, { backgroundColor: colors.primary }]}>
                <Icon name={family === "telegram" ? "send" : "arrow-up"} size={20} color={colors.onPrimary} />
              </Pressable>
            ) : (
              <Pressable onPress={toggleVoice} style={[styles.sendBtn, { backgroundColor: recording ? colors.danger : colors.primary }]}>
                <Icon name={recording ? "stop" : "mic"} size={20} color={colors.onPrimary} />
              </Pressable>
            )}
          </View>

          {emoji ? <EmojiPicker onPick={(e) => setText((p) => p + e)} /> : null}
        </KeyboardAvoidingView>
        </>
        )}
      </View>

      {/* meniu long-press: editează / șterge */}
      <Modal visible={!!menuMsg} transparent animationType="fade" onRequestClose={() => setMenuMsg(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setMenuMsg(null)}>
          <View style={[styles.sheet, { backgroundColor: colors.bgRaised, borderColor: colors.border, marginBottom: insets.bottom + space.md }]}>
            {menuMsg && menuMsg.fromMe && menuMsg.text && !menuMsg.attachment ? (
              <Pressable style={styles.sheetItem} onPress={() => menuMsg && startEdit(menuMsg)}>
                <Icon name="create" size={18} color={colors.accent} />
                <Text style={[styles.sheetLabel, { color: colors.textPrimary }]}>{t.conversation.edit}</Text>
              </Pressable>
            ) : null}
            {menuMsg && menuMsg.fromMe && !conv.group ? (
              <Pressable style={styles.sheetItem} onPress={() => menuMsg && deleteForAll(menuMsg)}>
                <Text style={[styles.sheetGlyph, { color: colors.danger }]}>🗑</Text>
                <Text style={[styles.sheetLabel, { color: colors.danger }]}>{t.conversation.deleteForAll}</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.sheetItem} onPress={() => menuMsg && deleteForMe(menuMsg)}>
              <Text style={[styles.sheetGlyph, { color: colors.danger }]}>🗑</Text>
              <Text style={[styles.sheetLabel, { color: colors.danger }]}>{t.conversation.deleteForMe}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* verificare contact (safety number) — anti-MITM / anti-impersonare */}
      {!conv.group ? (
        <VerifySafetyModal
          visible={verifyOpen}
          convId={conv.id}
          peerDid={conv.did}
          peerName={conv.name}
          onClose={() => setVerifyOpen(false)}
        />
      ) : null}

      {/* opțiuni conversație: blocare + auto-ștergere */}
      <Modal visible={optionsOpen} transparent animationType="slide" onRequestClose={() => setOptionsOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setOptionsOpen(false)}>
          <Pressable style={[styles.optionsSheet, { backgroundColor: colors.bgRaised, borderColor: colors.border, paddingBottom: insets.bottom + space.lg }]} onPress={() => {}}>
            <View style={[styles.grip, { backgroundColor: colors.border }]} />
            <Text style={type.h3}>{t.lock.convOptions}</Text>

            {/* Blocare */}
            <Pressable
              style={styles.optRow}
              onPress={() => {
                if (conv.locked) {
                  Alert.alert(t.lock.removePassword, "?", [
                    { text: t.common.cancel, style: "cancel" },
                    { text: t.lock.removePassword, style: "destructive", onPress: async () => { await clearConvPasscode(conv.id); setConvLocked(conv.id, false); } },
                  ]);
                } else { setOptionsOpen(false); setLockMode("set"); }
              }}
            >
              <Icon name={conv.locked ? "lock-open" : "lock-closed"} size={20} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={[type.body]}>{conv.locked ? t.lock.removePassword : t.lock.convLock}</Text>
                <Text style={type.caption}>{t.lock.convLockBody}</Text>
              </View>
            </Pressable>

            {/* Auto-ștergere */}
            <Text style={[type.label, { marginTop: space.lg, marginBottom: space.sm }]}>{t.lock.disappearing}</Text>
            <Text style={[type.caption, { marginBottom: space.sm }]}>{t.lock.disappearingBody}</Text>
            <View style={styles.burnGrid}>
              {BURN_OPTIONS.map((o) => {
                const active = conv.burnAfterReadMs === o.ms;
                return (
                  <Pressable key={o.key} onPress={() => setBurnTimer(conv.id, o.ms)} style={[styles.burnChip, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : "transparent" }]}>
                    <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: active ? colors.onPrimary : colors.textSecondary }}>{burnLabel(o, t.lock.off)}</Text>
                  </Pressable>
                );
              })}
            </View>
            {conv.burnAfterReadMs ? <Text style={[type.caption, { marginTop: space.sm, color: colors.accent }]}>⏳ {t.lock.burnNote}</Text> : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* parolă conversație: setare sau verificare */}
      <PasscodeModal
        visible={lockMode !== null}
        mode={lockMode === "set" ? "set" : "verify"}
        title={lockMode === "set" ? t.lock.convLock : t.lock.unlockConv}
        subtitle={lockMode === "set" ? t.lock.convLockBody : t.lock.unlockConvBody}
        onCancel={() => { if (lockMode === "verify" && !unlocked) router.back(); setLockMode(null); }}
        onSubmit={async (pin) => {
          if (lockMode === "set") {
            await setConvPasscode(conv.id, pin);
            setConvLocked(conv.id, true);
            setUnlocked(true); // rămâi în conversație după ce o blochezi
            setLockMode(null);
            return true;
          }
          const ok = await verifyConvPasscode(conv.id, pin);
          if (ok) { setUnlocked(true); setLockMode(null); }
          return ok;
        }}
      />
    </MeshBackground>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  back: { fontSize: 34, width: 24, marginTop: -4 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { fontFamily: fonts.bodySemibold, fontSize: 16, flexShrink: 1 },
  ratchet: { fontFamily: fonts.mono, fontSize: 11, marginTop: 1 },
  qr: { fontSize: 22 },
  headerCenter: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.sm },
  headerIcons: { flexDirection: "row", alignItems: "center", gap: space.md },
  camBtn: { width: 36, height: 36, borderRadius: 18 },
  keyAlert: { flexDirection: "row", alignItems: "center", gap: space.md, margin: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  verifyNudge: { flexDirection: "row", alignItems: "center", gap: space.sm, marginHorizontal: space.md, marginTop: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  verifyNudgeText: { flex: 1, fontFamily: fonts.body, fontSize: 12 },
  keyAlertTitle: { fontFamily: fonts.bodySemibold, fontSize: 13 },
  keyAlertBody: { fontFamily: fonts.body, fontSize: 12, marginTop: 2 },
  verifyBtn: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  verifyText: { fontFamily: fonts.bodySemibold, fontSize: 13 },
  list: { padding: space.md, paddingBottom: space.lg, gap: 2 },
  attachMenu: { flexDirection: "row", flexWrap: "wrap", gap: space.lg, padding: space.lg, marginHorizontal: space.md, marginBottom: space.sm, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, justifyContent: "space-around" },
  attachItem: { alignItems: "center", gap: 6, width: 64 },
  attachIcon: { width: 52, height: 52, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  attachLabel: { fontFamily: fonts.bodyMedium, fontSize: 11 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: space.xs, paddingHorizontal: space.sm, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 38, height: 44, alignItems: "center", justifyContent: "center" },
  composerGlyph: { fontSize: 22 },
  input: { flex: 1, maxHeight: 120, minHeight: 44, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, paddingVertical: space.md, fontFamily: fonts.body, fontSize: 15 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  sendGlyph: { fontSize: 18, fontWeight: "700" },
  editBanner: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  editGlyph: { fontSize: 16 },
  editText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 13 },
  editClose: { fontSize: 14 },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { marginHorizontal: space.md, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  sheetItem: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.lg },
  sheetGlyph: { fontSize: 18, width: 24, textAlign: "center" },
  sheetLabel: { fontFamily: fonts.bodySemibold, fontSize: 15 },
  lockedArea: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xxl },
  unlockBtn: { marginTop: space.xl, paddingHorizontal: space.xxl, height: 48, borderRadius: radius.xl, alignItems: "center", justifyContent: "center" },
  optionsSheet: { borderTopLeftRadius: radius["2xl"], borderTopRightRadius: radius["2xl"], borderWidth: StyleSheet.hairlineWidth, padding: space.lg },
  grip: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: space.md },
  optRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  burnGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  burnChip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.full, borderWidth: 1 },
});
