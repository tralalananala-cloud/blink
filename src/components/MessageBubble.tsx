import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { radius, space } from "../theme/tokens";
import { fonts } from "../theme/typography";
import { Message } from "../data/mockData";
import { useTheme } from "../theme/ThemeProvider";
import { useI18n } from "../i18n";
import { AttachmentView } from "./AttachmentView";

// M5 — memoizat: un rând nu se mai re-randează când lista se re-randează,
// decât dacă i se schimbă chiar mesajul sau handler-ul (rafalele de bife nu mai
// re-randează toată conversația).
export const MessageBubble = React.memo(MessageBubbleImpl);

const STATUS_ICON: Record<Message["status"], string> = {
  sending: "◌",
  sent: "✓",
  relayed: "⇡",
  delivered: "✓✓",
  read: "✓✓",
  received: "",
};

function clock(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

function MessageBubbleImpl({ msg, onLongPress }: { msg: Message; onLongPress?: (m: Message) => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const mine = msg.fromMe;
  const att = msg.attachment;
  // cerculețele se afișează „goale" (fără fundal de bulă)
  const bare = att?.kind === "circle";

  const bubbleBg = mine ? colors.bubbleMine : colors.bubbleTheirs;
  const fg = mine ? colors.bubbleMineText : colors.bubbleTheirsText;
  const metaColor = mine ? colors.bubbleMineText : colors.textMuted;
  const gradient = mine && !bare ? colors.bubbleMineGradient : undefined;

  function longPress() {
    if (!onLongPress) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onLongPress(msg);
  }

  return (
    <View style={[styles.wrap, mine ? styles.wrapMine : styles.wrapTheirs]}>
      <Pressable
        onLongPress={longPress}
        delayLongPress={250}
        style={({ pressed }) => [
          styles.bubble,
          bare
            ? { backgroundColor: "transparent", padding: 0 }
            : {
                backgroundColor: gradient ? "transparent" : bubbleBg,
                borderColor: colors.bubbleTheirsBorder,
                borderWidth: mine ? 0 : StyleSheet.hairlineWidth,
                overflow: gradient ? "hidden" : "visible",
              },
          mine ? styles.mine : styles.theirs,
          pressed && onLongPress ? { opacity: 0.85 } : null,
        ]}
      >
        {gradient ? (
          <LinearGradient colors={gradient as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        ) : null}
        {att ? <View style={msg.text ? { marginBottom: 6 } : null}><AttachmentView att={att} mine={mine} /></View> : null}
        {msg.text ? <Text style={[styles.text, { color: fg }]}>{msg.text}</Text> : null}
        {!bare ? (
          <View style={styles.meta}>
            {msg.edited ? <Text style={[styles.edited, { color: metaColor, opacity: 0.6 }]}>{t.conversation.edited}</Text> : null}
            <Text style={[styles.time, { color: metaColor, opacity: 0.6 }]}>{clock(msg.ts)}</Text>
            {mine ? (
              <Text style={[styles.tick, { color: msg.status === "read" ? colors.secure : metaColor, opacity: msg.status === "read" ? 1 : 0.7 }]}>
                {STATUS_ICON[msg.status]}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 3, maxWidth: "82%" },
  wrapMine: { alignSelf: "flex-end" },
  wrapTheirs: { alignSelf: "flex-start" },
  bubble: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg },
  mine: { borderBottomRightRadius: radius.sm },
  theirs: { borderBottomLeftRadius: radius.sm },
  text: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 2 },
  time: { fontFamily: fonts.mono, fontSize: 10 },
  tick: { fontFamily: fonts.mono, fontSize: 10 },
  edited: { fontFamily: fonts.body, fontSize: 10, fontStyle: "italic" },
});
