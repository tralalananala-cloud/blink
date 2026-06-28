import React, { useEffect, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { confirmDestructive } from "../../src/ui/confirm";
import * as Haptics from "expo-haptics";
import { Icon } from "../../src/components/Icon";
import { Screen } from "../../src/components/Screen";
import { Avatar } from "../../src/components/Avatar";
import { UnreadBadge, VerifiedBadge } from "../../src/components/Badges";
import { SecurityBanner } from "../../src/components/SecurityBanner";
import { UpdateBanner } from "../../src/components/UpdateBanner";
import { clearConvPasscode } from "../../src/security/lock";
import { radius, space } from "../../src/theme/tokens";
import { fonts } from "../../src/theme/typography";
import { useTheme, useType } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { useApp } from "../../src/state/store";
import { relay } from "../../src/messaging/relay";
import { Conversation } from "../../src/data/mockData";

function ago(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "acum";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}z`;
}

function NetPill() {
  const { colors } = useTheme();
  const [online, setOnline] = useState(relay.isConnected());
  useEffect(() => {
    const iv = setInterval(() => setOnline(relay.isConnected()), 2000);
    return () => clearInterval(iv);
  }, []);
  const color = online ? colors.secure : colors.warning;
  return (
    <View style={[pill.net, { borderColor: color }]}>
      <View style={[pill.netDot, { backgroundColor: color }]} />
      <Text style={[pill.netText, { color }]}>{online ? "RELAY" : "OFFLINE"}</Text>
    </View>
  );
}

export default function Chats() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insetsBottom = space.md;
  const conversations = useApp((s) => s.conversations);
  const deleteConversation = useApp((s) => s.deleteConversation);
  const blockContact = useApp((s) => s.blockContact);
  const type = useType();
  const [menuConv, setMenuConv] = useState<Conversation | null>(null);
  const sorted = [...conversations].sort((a, b) => b.lastTs - a.lastTs);

  function confirmDelete(c: Conversation) {
    setMenuConv(null);
    confirmDestructive(t.chats.deleteConfirm, c.name, t.chats.deleteChat, () => {
      if (!c.group) relay.sendDeleteConv(c.did).catch(() => {}); // șterge și la celălalt
      clearConvPasscode(c.id).catch(() => {});
      deleteConversation(c.id);
    }, t.common.cancel);
  }
  function confirmBlock(c: Conversation) {
    setMenuConv(null);
    confirmDestructive(t.chats.blockContact, t.chats.blockConfirm, t.chats.blockContact, () => {
      clearConvPasscode(c.id).catch(() => {});
      blockContact(c.id);
    }, t.common.cancel);
  }

  return (
    <Screen title={t.tabs.chats} right={<NetPill />}>
      <View style={{ marginBottom: space.md, gap: space.sm }}>
        <UpdateBanner />
        <SecurityBanner />
      </View>
      <FlatList
        data={sorted}
        keyExtractor={(c) => c.id}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.borderSoft, marginLeft: 60 }} />}
        ListEmptyComponent={
          <View style={{ alignItems: "center", marginTop: 56, gap: 6 }}>
            <Text style={[type.body, { color: colors.textPrimary }]}>{t.chats.empty}</Text>
            <Text style={type.caption}>{t.chats.emptyHint}</Text>
          </View>
        }
        renderItem={({ item }) => <ChatRow conv={item} onLongPress={setMenuConv} />}
        contentContainerStyle={{ paddingBottom: space.xl }}
        initialNumToRender={12}
        maxToRenderPerBatch={10}
        windowSize={11}
        removeClippedSubviews
      />

      <Modal visible={!!menuConv} transparent animationType="fade" onRequestClose={() => setMenuConv(null)}>
        <Pressable style={sheet.backdrop} onPress={() => setMenuConv(null)}>
          <View style={[sheet.sheet, { backgroundColor: colors.bgRaised, borderColor: colors.border, marginBottom: insetsBottom + 24 }]}>
            <Text style={[sheet.title, { color: colors.textMuted }]} numberOfLines={1}>{menuConv?.name}</Text>
            <Pressable style={sheet.item} onPress={() => menuConv && confirmDelete(menuConv)}>
              <Icon name="trash-outline" size={20} color={colors.danger} />
              <Text style={[sheet.label, { color: colors.danger }]}>{t.chats.deleteChat}</Text>
            </Pressable>
            {!menuConv?.group && (
              <Pressable style={sheet.item} onPress={() => menuConv && confirmBlock(menuConv)}>
                <Icon name="ban-outline" size={20} color={colors.danger} />
                <Text style={[sheet.label, { color: colors.danger }]}>{t.chats.blockContact}</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

// M5 — memoizat (vezi MessageBubble): rândurile nu se re-randează la fiecare update de listă.
const ChatRow = React.memo(ChatRowImpl);

function ChatRowImpl({ conv, onLongPress }: { conv: Conversation; onLongPress: (c: Conversation) => void }) {
  const { colors } = useTheme();
  const last = conv.messages[conv.messages.length - 1];
  const preview = last?.attachment ? `${ATT_PREVIEW[last.attachment.kind]} ${last.text}`.trim() : last?.text;
  return (
    <Pressable
      style={({ pressed }) => [row.row, pressed && { opacity: 0.7 }]}
      onPress={() => router.push(`/chat/${conv.id}`)}
      onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); onLongPress(conv); }}
      delayLongPress={250}
    >
      <Avatar name={conv.name} did={conv.did} group={conv.group} />
      <View style={row.mid}>
        <View style={row.line}>
          <Text style={[row.name, { color: colors.textPrimary }]} numberOfLines={1}>{conv.name}</Text>
          {conv.verified ? <VerifiedBadge verified /> : null}
          {conv.ephemeral ? <Text style={[row.eph, { color: colors.accent }]}>⧗ {conv.ephemeral}</Text> : null}
        </View>
        <Text style={[row.preview, { color: colors.textSecondary }]} numberOfLines={1}>
          {last?.fromMe ? "Tu: " : ""}{preview}
        </Text>
      </View>
      <View style={row.right}>
        <Text style={[row.time, { color: colors.textMuted }]}>{ago(conv.lastTs)}</Text>
        <UnreadBadge count={conv.unread} />
      </View>
    </Pressable>
  );
}

const ATT_PREVIEW: Record<string, string> = { image: "🖼️ Poză", video: "🎞️ Video", file: "📎 Fișier", voice: "🎤 Voce", circle: "⏺️ Cerculeț" };

const row = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  mid: { flex: 1, gap: 3 },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { fontFamily: fonts.bodySemibold, fontSize: 15, flexShrink: 1 },
  eph: { fontFamily: fonts.mono, fontSize: 11 },
  preview: { fontFamily: fonts.body, fontSize: 13 },
  right: { alignItems: "flex-end", gap: 6 },
  time: { fontFamily: fonts.mono, fontSize: 11 },
});

const pill = StyleSheet.create({
  net: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.full, paddingHorizontal: space.sm, paddingVertical: 4 },
  netDot: { width: 6, height: 6, borderRadius: 3 },
  netText: { fontFamily: fonts.monoMedium, fontSize: 10, letterSpacing: 0.5 },
});

const sheet = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { marginHorizontal: space.md, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden", paddingVertical: space.xs },
  title: { fontFamily: fonts.bodyMedium, fontSize: 12, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs },
  item: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.lg },
  label: { fontFamily: fonts.bodySemibold, fontSize: 15 },
});
