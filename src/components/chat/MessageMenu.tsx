/** Meniu long-press pe mesaj (prezentațional) — editează / șterge pt toți / șterge pt mine.
 *  Acțiunile sunt injectate; nicio stare proprie. */
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../Icon";
import { useTheme } from "../../theme/ThemeProvider";
import { useI18n } from "../../i18n";
import { radius, space } from "../../theme/tokens";
import { fonts } from "../../theme/typography";
import { Message } from "../../data/mockData";

type Props = {
  msg: Message | null;
  isGroup: boolean;
  insetsBottom: number;
  onClose: () => void;
  onEdit: (m: Message) => void;
  onDeleteForAll: (m: Message) => void;
  onDeleteForMe: (m: Message) => void;
};

export function MessageMenu({ msg, isGroup, insetsBottom, onClose, onEdit, onDeleteForAll, onDeleteForMe }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <Modal visible={!!msg} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <View style={[styles.sheet, { backgroundColor: colors.bgRaised, borderColor: colors.border, marginBottom: insetsBottom + space.md }]}>
          {msg && msg.fromMe && msg.text && !msg.attachment ? (
            <Pressable style={styles.sheetItem} onPress={() => msg && onEdit(msg)}>
              <Icon name="create" size={18} color={colors.accent} />
              <Text style={[styles.sheetLabel, { color: colors.textPrimary }]}>{t.conversation.edit}</Text>
            </Pressable>
          ) : null}
          {msg && msg.fromMe && !isGroup ? (
            <Pressable style={styles.sheetItem} onPress={() => msg && onDeleteForAll(msg)}>
              <Text style={[styles.sheetGlyph, { color: colors.danger }]}>🗑</Text>
              <Text style={[styles.sheetLabel, { color: colors.danger }]}>{t.conversation.deleteForAll}</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.sheetItem} onPress={() => msg && onDeleteForMe(msg)}>
            <Text style={[styles.sheetGlyph, { color: colors.danger }]}>🗑</Text>
            <Text style={[styles.sheetLabel, { color: colors.danger }]}>{t.conversation.deleteForMe}</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { marginHorizontal: space.md, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  sheetItem: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.lg },
  sheetGlyph: { fontSize: 18, width: 24, textAlign: "center" },
  sheetLabel: { fontFamily: fonts.bodySemibold, fontSize: 15 },
});
