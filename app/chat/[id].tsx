import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
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
import { Message } from "../../src/data/mockData";
import { dismissConversation } from "../../src/notify";
import { callManager } from "../../src/calls/webrtc";
import { PasscodeModal } from "../../src/components/PasscodeModal";
import { VerifySafetyModal } from "../../src/components/VerifySafetyModal";
import { AttachMenu } from "../../src/components/chat/AttachMenu";
import { Composer } from "../../src/components/chat/Composer";
import { MessageMenu } from "../../src/components/chat/MessageMenu";
import { ConvOptionsSheet } from "../../src/components/chat/ConvOptionsSheet";
import { GroupMembersSheet } from "../../src/components/chat/GroupMembersSheet";
import { confirmDestructive } from "../../src/ui/confirm";
import { useChatMessages } from "../../src/components/chat/useChatMessages";
import { useMediaSend } from "../../src/components/chat/useMediaSend";
import { BURN_OPTIONS, burnLabel } from "../../src/components/chat/burnOptions";
import { clearConvPasscode, hasConvPasscode, setConvPasscode, verifyConvPasscode } from "../../src/security/lock";

// T1 (batch stabilitate): apelurile voce/video sunt ASCUNSE până rulează WebRTC pe device.
// Comută pe `true` ca să readuci iconițele de apel în headerul conversației.
const CALLS_ENABLED = false;

export default function Conversation() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useI18n();
  const { colors, family } = useTheme();
  const type = useType();
  const insets = useSafeAreaInsets();
  const conv = useApp((s) => s.conversations.find((c) => c.id === id));
  const setConvLocked = useApp((s) => s.setConvLocked);
  const setBurnTimer = useApp((s) => s.setBurnTimer);
  const markRead = useApp((s) => s.markRead);
  const clearUnread = useApp((s) => s.clearUnread);
  const markVerified = useApp((s) => s.markVerified);
  const burnSweep = useApp((s) => s.burnSweep);
  const applyRemoteDeleteConv = useApp((s) => s.applyRemoteDeleteConv);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [lockMode, setLockMode] = useState<null | "set" | "verify">(null);
  const [unlocked, setUnlocked] = useState(true);
  const [menuMsg, setMenuMsg] = useState<Message | null>(null);
  const inputRef = useRef<TextInput>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [keyChanged, setKeyChanged] = useState(false);
  const [emoji, setEmoji] = useState(false);
  const [attach, setAttach] = useState(false);
  const listRef = useRef<FlatList>(null);
  // true cât timp utilizatorul e jos de tot; doar atunci auto-derulăm la fund (la mesaj nou /
  // deschiderea tastaturii). Altfel, dacă a derulat în sus să citească istoricul, NU-l mai smucim.
  const atBottomRef = useRef(true);

  // Hook-uri cu stare (Faza 3.3 finalizare) — apelate ÎNAINTE de orice early return.
  const chat = useChatMessages(conv, { listRef, inputRef, setEmoji, setMenuMsg, setSession });
  const media = useMediaSend({ deliver: chat.deliver, setAttach });

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

  const hasText = chat.text.trim().length > 0;
  const myDid = useApp.getState().identity?.did;
  // Scos/plecat din grup → composer înlocuit cu notă onestă (istoricul rămâne vizibil).
  const isMember = !conv.group || (!!myDid && (conv.members ?? []).includes(myDid));
  const toggleAttach = () => { setAttach((v) => !v); setEmoji(false); };
  const toggleEmoji = () => { setEmoji((v) => !v); setAttach(false); };
  const toggleConvLock = () => {
    if (!conv) return;
    if (conv.locked) {
      Alert.alert(t.lock.removePassword, "?", [
        { text: t.common.cancel, style: "cancel" },
        { text: t.lock.removePassword, style: "destructive", onPress: async () => { await clearConvPasscode(conv.id); setConvLocked(conv.id, false); } },
      ]);
    } else { setOptionsOpen(false); setLockMode("set"); }
  };
  // T3 — șterge conversația la ambii. dc e autentificat pe sesiune (doar peer-ul real poate
  // trimite un dc care se decriptează). Copy ONEST: cooperativ, nu garantat. Dacă peer offline,
  // releul cozează plicul și îl livrează la reconectarea lui.
  const onDeleteBoth = () => {
    if (!conv) return;
    confirmDestructive(
      t.lock.deleteBoth,
      t.lock.deleteBothWarn,
      t.lock.deleteBothConfirm,
      () => {
        relay.sendDeleteConv(conv.did);      // anunță peer-ul (best effort / cozat de releu dacă e offline)
        applyRemoteDeleteConv(conv.did);      // golește local (aceeași cale ca la primirea unui dc)
        setOptionsOpen(false);
        router.back();
      },
      t.common.cancel,
    );
  };

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
                <Text style={[styles.ratchet, { color: colors.secure }]}>
                  👥 {format(t.friends.membersCount, { n: conv.members?.length ?? 0 })} · 🔒 E2E
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
            {/* Apel audio/video — doar 1:1 (Faza 5 WebRTC).
                ASCUNS (T1 stabilitate): codul WebRTC n-a rulat pe device → buton mort =
                instabilitate percepută. callManager + codec k:"call" rămân intacte;
                revin la CALLS_ENABLED=true după testul pe device. */}
            {CALLS_ENABLED && !conv.group ? (
              <>
                <Pressable hitSlop={8} onPress={() => callManager.startCall(conv.did, false)}>
                  <Icon name="call" size={22} color={family === "cipher" ? colors.accent : colors.primary} />
                </Pressable>
                <Pressable hitSlop={8} onPress={() => callManager.startCall(conv.did, true)}>
                  <Icon name="videocam" size={24} color={family === "cipher" ? colors.accent : colors.primary} />
                </Pressable>
              </>
            ) : null}
            {/* Ștergere expresă din header — același flux ca „Șterge la ambii" din opțiuni
                (confirmare destructivă, apoi dc către peer + golire locală). */}
            {!conv.group ? (
              <Pressable hitSlop={8} onPress={onDeleteBoth}>
                <Icon name="trash-outline" size={22} color={colors.danger} />
              </Pressable>
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
          {attach ? <AttachMenu onPick={media.runAttach} /> : null}

          {/* banner editare */}
          {chat.editingId ? (
            <View style={[styles.editBanner, { backgroundColor: colors.bgRaised, borderTopColor: colors.border }]}>
              <Icon name="create" size={16} color={colors.accent} />
              <Text style={[styles.editText, { color: colors.textSecondary }]} numberOfLines={1}>{t.conversation.editing}</Text>
              <Pressable hitSlop={10} onPress={chat.cancelEdit}>
                <Text style={[styles.editClose, { color: colors.textMuted }]}>✕</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Composer — iconițe per familie de temă */}
          {!isMember ? (
            <View style={[styles.notMember, { borderTopColor: colors.border, paddingBottom: insets.bottom + space.sm }]}>
              <Text style={type.bodyMuted}>{t.friends.notMember}</Text>
            </View>
          ) : (
          <Composer
            family={family}
            text={chat.text}
            onChangeText={chat.setText}
            onFocus={() => setEmoji(false)}
            hasText={hasText}
            recording={media.recording}
            emoji={emoji}
            inputRef={inputRef}
            placeholder={media.recording ? "● …" : t.conversation.placeholder}
            paddingBottom={emoji ? space.sm : insets.bottom + space.sm}
            onToggleAttach={toggleAttach}
            onToggleEmoji={toggleEmoji}
            onSend={chat.sendText}
            onToggleVoice={media.toggleVoice}
          />
          )}

          {emoji ? <EmojiPicker onPick={(e) => chat.setText((p) => p + e)} /> : null}
        </KeyboardAvoidingView>
        </>
        )}
      </View>

      {/* meniu long-press: editează / șterge */}
      <MessageMenu
        msg={menuMsg}
        isGroup={conv.group}
        insetsBottom={insets.bottom}
        onClose={() => setMenuMsg(null)}
        onEdit={chat.startEdit}
        onDeleteForAll={chat.deleteForAll}
        onDeleteForMe={chat.deleteForMe}
      />

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
      <ConvOptionsSheet
        visible={optionsOpen}
        locked={!!conv.locked}
        burnAfterReadMs={conv.burnAfterReadMs}
        insetsBottom={insets.bottom}
        onClose={() => setOptionsOpen(false)}
        onToggleLock={toggleConvLock}
        onSetBurn={(ms) => setBurnTimer(conv.id, ms)}
        onDeleteBoth={onDeleteBoth}
        isGroup={conv.group}
        onMembers={() => { setOptionsOpen(false); setMembersOpen(true); }}
      />

      {/* membrii grupului: add/remove (admin) + leave */}
      {conv.group ? (
        <GroupMembersSheet visible={membersOpen} gid={conv.id} insetsBottom={insets.bottom} onClose={() => setMembersOpen(false)} />
      ) : null}

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
  keyAlert: { flexDirection: "row", alignItems: "center", gap: space.md, margin: space.md, padding: space.md, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  verifyNudge: { flexDirection: "row", alignItems: "center", gap: space.sm, marginHorizontal: space.md, marginTop: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  verifyNudgeText: { flex: 1, fontFamily: fonts.body, fontSize: 12 },
  keyAlertTitle: { fontFamily: fonts.bodySemibold, fontSize: 13 },
  keyAlertBody: { fontFamily: fonts.body, fontSize: 12, marginTop: 2 },
  verifyBtn: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  verifyText: { fontFamily: fonts.bodySemibold, fontSize: 13 },
  list: { padding: space.md, paddingBottom: space.lg, gap: 2 },
  composerGlyph: { fontSize: 22 },
  sendGlyph: { fontSize: 18, fontWeight: "700" },
  editBanner: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  editGlyph: { fontSize: 16 },
  editText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 13 },
  editClose: { fontSize: 14 },
  lockedArea: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xxl },
  notMember: { alignItems: "center", paddingTop: space.md, paddingHorizontal: space.lg, borderTopWidth: StyleSheet.hairlineWidth },
  unlockBtn: { marginTop: space.xl, paddingHorizontal: space.xxl, height: 48, borderRadius: radius.xl, alignItems: "center", justifyContent: "center" },
});
