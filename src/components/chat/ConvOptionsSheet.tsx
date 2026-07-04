/** Opțiuni conversație (prezentațional) — blocare cu parolă + auto-ștergere (burn-after-read).
 *  Logica (Alert de scoatere parolă, setarea parolei) e injectată prin onToggleLock; nicio stare proprie. */
import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../Icon";
import { useTheme, useType } from "../../theme/ThemeProvider";
import { useI18n } from "../../i18n";
import { radius, space } from "../../theme/tokens";
import { fonts } from "../../theme/typography";
import { BURN_OPTIONS, burnLabel } from "./burnOptions";

type Props = {
  visible: boolean;
  locked: boolean;
  burnAfterReadMs: number | undefined;
  insetsBottom: number;
  onClose: () => void;
  onToggleLock: () => void;
  onSetBurn: (ms: number | undefined) => void;
  onDeleteBoth: () => void;
};

export function ConvOptionsSheet({ visible, locked, burnAfterReadMs, insetsBottom, onClose, onToggleLock, onSetBurn, onDeleteBoth }: Props) {
  const { colors } = useTheme();
  const type = useType();
  const { t } = useI18n();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={[styles.optionsSheet, { backgroundColor: colors.bgRaised, borderColor: colors.border, paddingBottom: insetsBottom + space.lg }]} onPress={() => {}}>
          <View style={[styles.grip, { backgroundColor: colors.border }]} />
          <Text style={type.h3}>{t.lock.convOptions}</Text>

          {/* Blocare */}
          <Pressable style={styles.optRow} onPress={onToggleLock}>
            <Icon name={locked ? "lock-open" : "lock-closed"} size={20} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={[type.body]}>{locked ? t.lock.removePassword : t.lock.convLock}</Text>
              <Text style={type.caption}>{t.lock.convLockBody}</Text>
            </View>
          </Pressable>

          {/* Auto-ștergere */}
          <Text style={[type.label, { marginTop: space.lg, marginBottom: space.sm }]}>{t.lock.disappearing}</Text>
          <Text style={[type.caption, { marginBottom: space.sm }]}>{t.lock.disappearingBody}</Text>
          <View style={styles.burnGrid}>
            {BURN_OPTIONS.map((o) => {
              const active = burnAfterReadMs === o.ms;
              return (
                <Pressable key={o.key} onPress={() => onSetBurn(o.ms)} style={[styles.burnChip, { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : "transparent" }]}>
                  <Text style={{ fontFamily: fonts.bodyMedium, fontSize: 13, color: active ? colors.onPrimary : colors.textSecondary }}>{burnLabel(o, t.lock.off)}</Text>
                </Pressable>
              );
            })}
          </View>
          {burnAfterReadMs ? <Text style={[type.caption, { marginTop: space.sm, color: colors.accent }]}>⏳ {t.lock.burnNote}</Text> : null}

          {/* Șterge conversația la ambii — protocol dc autentificat pe sesiune (T3) */}
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Pressable style={styles.optRow} onPress={onDeleteBoth}>
            <Icon name="trash-outline" size={20} color={colors.danger} />
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { color: colors.danger }]}>{t.lock.deleteBoth}</Text>
              <Text style={type.caption}>{t.lock.deleteBothBody}</Text>
            </View>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  optionsSheet: { borderTopLeftRadius: radius["2xl"], borderTopRightRadius: radius["2xl"], borderWidth: StyleSheet.hairlineWidth, padding: space.lg },
  grip: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: space.md },
  optRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  burnGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  burnChip: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.full, borderWidth: 1 },
  divider: { height: StyleSheet.hairlineWidth, marginTop: space.lg, marginBottom: space.xs },
});
