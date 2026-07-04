/** Composer (prezentațional) — input + butoane send/voice/attach/emoji, layout per familie de temă.
 *  Toate valorile + callback-urile vin din afară; nicio stare proprie (rămâne în Conversation). */
import React from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Icon } from "../Icon";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, space } from "../../theme/tokens";
import { fonts } from "../../theme/typography";

type Props = {
  family: string;
  text: string;
  onChangeText: (t: string) => void;
  onFocus: () => void;
  hasText: boolean;
  recording: boolean;
  emoji: boolean;
  inputRef: React.RefObject<TextInput>;
  placeholder: string;
  paddingBottom: number;
  onToggleAttach: () => void;
  onToggleEmoji: () => void;
  onSend: () => void;
  onToggleVoice: () => void;
};

export function Composer({
  family, text, onChangeText, onFocus, hasText, recording, emoji, inputRef,
  placeholder, paddingBottom, onToggleAttach, onToggleEmoji, onSend, onToggleVoice,
}: Props) {
  const { colors } = useTheme();
  return (
    <View style={[styles.composer, { paddingBottom, backgroundColor: colors.bgRaised, borderTopColor: colors.border }]}>
      {/* butoane STÂNGA */}
      {family === "messenger" ? (
        <Pressable onPress={onToggleAttach} hitSlop={8} style={[styles.iconBtn, styles.camBtn, { backgroundColor: colors.primary }]}>
          <Icon name="camera" size={20} color={colors.onPrimary} />
        </Pressable>
      ) : family === "telegram" ? (
        <Pressable onPress={onToggleEmoji} hitSlop={8} style={styles.iconBtn}>
          <Icon name={emoji ? "chatbox-ellipses-outline" : "happy-outline"} size={24} color={colors.textMuted} />
        </Pressable>
      ) : (
        <>
          <Pressable onPress={onToggleAttach} hitSlop={8} style={styles.iconBtn}>
            <Icon name="add-circle-outline" size={26} color={colors.accent} />
          </Pressable>
          <Pressable onPress={onToggleEmoji} hitSlop={8} style={styles.iconBtn}>
            <Icon name={emoji ? "keypad-outline" : "happy-outline"} size={24} color={colors.textSecondary} />
          </Pressable>
        </>
      )}

      <TextInput
        ref={inputRef}
        value={text}
        onChangeText={onChangeText}
        onFocus={onFocus}
        placeholder={placeholder}
        placeholderTextColor={recording ? colors.danger : colors.textMuted}
        style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary }]}
        multiline
      />

      {/* butoane DREAPTA */}
      {family === "telegram" && !hasText ? (
        <Pressable onPress={onToggleAttach} hitSlop={8} style={styles.iconBtn}>
          <Icon name="attach" size={26} color={colors.textMuted} />
        </Pressable>
      ) : family === "messenger" && !hasText ? (
        <Pressable onPress={onToggleEmoji} hitSlop={8} style={styles.iconBtn}>
          <Icon name={emoji ? "keypad-outline" : "happy-outline"} size={24} color={colors.primary} />
        </Pressable>
      ) : null}

      {hasText ? (
        <Pressable onPress={onSend} style={[styles.sendBtn, { backgroundColor: colors.primary }]}>
          <Icon name={family === "telegram" ? "send" : "arrow-up"} size={20} color={colors.onPrimary} />
        </Pressable>
      ) : (
        <Pressable onPress={onToggleVoice} style={[styles.sendBtn, { backgroundColor: recording ? colors.danger : colors.primary }]}>
          <Icon name={recording ? "stop" : "mic"} size={20} color={colors.onPrimary} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  composer: { flexDirection: "row", alignItems: "flex-end", gap: space.xs, paddingHorizontal: space.sm, paddingTop: space.sm, borderTopWidth: StyleSheet.hairlineWidth },
  iconBtn: { width: 38, height: 44, alignItems: "center", justifyContent: "center" },
  camBtn: { width: 36, height: 36, borderRadius: 18 },
  input: { flex: 1, maxHeight: 120, minHeight: 44, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, paddingVertical: space.md, fontFamily: fonts.body, fontSize: 15 },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
});
