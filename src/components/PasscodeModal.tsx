import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { radius, space } from "../theme/tokens";
import { fonts } from "../theme/typography";
import { useTheme, useType } from "../theme/ThemeProvider";
import { useI18n } from "../i18n";

interface Props {
  visible: boolean;
  mode: "set" | "verify";
  title: string;
  subtitle?: string;
  onCancel: () => void;
  /** Întoarce true dacă parola e acceptată (stocată / corectă). */
  onSubmit: (pin: string) => Promise<boolean>;
}

export function PasscodeModal({ visible, mode, title, subtitle, onCancel, onSubmit }: Props) {
  const { colors } = useTheme();
  const type = useType();
  const { t } = useI18n();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() { setPin(""); setConfirm(""); setErr(null); setBusy(false); }
  function cancel() { reset(); onCancel(); }

  async function submit() {
    if (pin.length < 4) { setErr(t.lock.tooShort); return; }
    if (mode === "set" && pin !== confirm) { setErr(t.lock.mismatch); return; }
    setBusy(true);
    const ok = await onSubmit(pin);
    setBusy(false);
    if (ok) { reset(); }
    else { setErr(t.lock.wrong); setPin(""); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}); }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      <View style={styles.backdrop}>
        <View style={[styles.card, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
          <Text style={[styles.lockIcon, { color: colors.primary }]}>🔒</Text>
          <Text style={[type.h3, { textAlign: "center" }]}>{title}</Text>
          {subtitle ? <Text style={[type.caption, { textAlign: "center", marginTop: 4 }]}>{subtitle}</Text> : null}

          <TextInput
            value={pin}
            onChangeText={(v) => { setPin(v); setErr(null); }}
            placeholder={t.lock.password}
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoFocus
            style={[styles.input, { backgroundColor: colors.surface, borderColor: err ? colors.danger : colors.border, color: colors.textPrimary }]}
          />
          {mode === "set" ? (
            <TextInput
              value={confirm}
              onChangeText={(v) => { setConfirm(v); setErr(null); }}
              placeholder={t.lock.confirm}
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary, marginTop: space.sm }]}
            />
          ) : null}
          {err ? <Text style={[styles.err, { color: colors.danger }]}>{err}</Text> : null}

          <View style={styles.actions}>
            <Pressable onPress={cancel} style={styles.btn}>
              <Text style={{ color: colors.textSecondary, fontFamily: fonts.bodySemibold }}>{t.common.cancel}</Text>
            </Pressable>
            <Pressable onPress={submit} disabled={busy} style={[styles.btn, styles.primaryBtn, { backgroundColor: colors.primary }]}>
              <Text style={{ color: colors.onPrimary, fontFamily: fonts.bodySemibold }}>{t.common.done}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center", padding: space.xl },
  card: { width: "100%", maxWidth: 360, borderRadius: radius["2xl"], borderWidth: StyleSheet.hairlineWidth, padding: space.xl, alignItems: "center" },
  lockIcon: { fontSize: 34, marginBottom: space.sm },
  input: { width: "100%", height: 50, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, fontFamily: fonts.body, fontSize: 16, marginTop: space.lg },
  err: { fontFamily: fonts.bodyMedium, fontSize: 12, marginTop: space.sm, alignSelf: "flex-start" },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.lg, width: "100%" },
  btn: { flex: 1, height: 48, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  primaryBtn: {},
});
