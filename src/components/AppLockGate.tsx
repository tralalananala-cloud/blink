import React, { useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as Haptics from "expo-haptics";
import { MeshBackground } from "./MeshBackground";
import { radius, space } from "../theme/tokens";
import { fonts } from "../theme/typography";
import { useTheme, useType } from "../theme/ThemeProvider";
import { useI18n } from "../i18n";
import { hasAppPasscode, verifyAppPasscode, unlockedConvs } from "../security/lock";
import { useApp, hydrateMessages } from "../state/store";
import { MESSAGES_IN_DB } from "../storage/messages";

/** Dacă există parolă de app, blochează tot până la deblocare. Altfel, transparent. */
export function AppLockGate({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false);
  const [locked, setLocked] = useState(false);
  const hasPass = useRef(false);

  useEffect(() => {
    let done = false;
    hasAppPasscode()
      .then((has) => {
        done = true;
        hasPass.current = has;
        setLocked(has);
        setChecked(true);
        if (has) tryBiometric();
      })
      .catch(() => { done = true; setChecked(true); }); // nu bloca dacă verificarea eșuează
    // plasă de siguranță: dacă SecureStore atârnă, deblochează după 2s
    const t = setTimeout(() => { if (!done) setChecked(true); }, 2000);
    return () => clearTimeout(t);
  }, []);

  // Igienă RAM — la trecerea în fundal: re-blochează + golește textele decriptate
  // din memorie + re-cere deblocarea conversațiilor. Doar dacă există parolă de app.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => {
      if (st === "background" && hasPass.current) {
        setLocked(true);
        unlockedConvs.clear();
        if (MESSAGES_IN_DB) useApp.getState().clearMessagesFromMemory();
      } else if (st === "active") {
        // Re-verifică dacă parola mai există (poate a fost scoasă din Settings într-o altă
        // ecran). Fără asta, hasPass.current rămâne „true" stale → ecran de lock pe care
        // nu-l poți trece (hash șters) = blocare permanentă.
        hasAppPasscode()
          .then((has) => { hasPass.current = has; if (!has) unlock(); })
          .catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);

  function unlock() {
    setLocked(false);
    if (MESSAGES_IN_DB) void hydrateMessages(); // re-încarcă mesajele golite la lock
  }

  async function tryBiometric() {
    try {
      const hw = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (hw && enrolled) {
        const r = await LocalAuthentication.authenticateAsync({ promptMessage: "Blink" });
        if (r.success) unlock();
      }
    } catch {
      /* noop */
    }
  }

  if (!checked) return <View style={{ flex: 1, backgroundColor: "#0A0C10" }} />;
  if (!locked) return <>{children}</>;
  return <LockScreen onUnlock={unlock} onBiometric={tryBiometric} />;
}

function LockScreen({ onUnlock, onBiometric }: { onUnlock: () => void; onBiometric: () => void }) {
  const { colors } = useTheme();
  const type = useType();
  const { t } = useI18n();
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);

  // Plasă de siguranță anti-blocare: dacă nu (mai) există nicio parolă setată,
  // nu ține userul captiv pe ecranul de lock — deblochează automat.
  useEffect(() => {
    hasAppPasscode().then((has) => { if (!has) onUnlock(); }).catch(() => {});
  }, []);

  async function submit() {
    if (busy) return;
    setBusy(true);
    try {
      if (!(await hasAppPasscode())) { onUnlock(); return; } // parolă inexistentă → intră
      const ok = await verifyAppPasscode(pin);
      if (ok) { onUnlock(); return; }
      setErr(true);
      setPin("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  return (
    <MeshBackground>
      <View style={styles.root}>
        <Text style={[styles.glyph, { color: colors.primary }]}>🔒</Text>
        <Text style={type.h2}>{t.lock.unlockApp}</Text>
        <Text style={[type.bodyMuted, { textAlign: "center", marginTop: 4 }]}>{t.lock.unlockAppBody}</Text>
        <TextInput
          value={pin}
          onChangeText={(v) => { setPin(v); setErr(false); }}
          placeholder={t.lock.password}
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          autoFocus
          onSubmitEditing={submit}
          style={[styles.input, { backgroundColor: colors.surface, borderColor: err ? colors.danger : colors.border, color: colors.textPrimary }]}
        />
        <Pressable onPress={submit} disabled={busy} style={[styles.btn, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}>
          <Text style={{ color: colors.onPrimary, fontFamily: fonts.bodySemibold, fontSize: 15 }}>{busy ? "…" : t.common.done}</Text>
        </Pressable>
        <Pressable onPress={onBiometric} style={{ marginTop: space.lg }}>
          <Text style={{ color: colors.accent, fontFamily: fonts.bodyMedium }}>{t.lock.biometric}</Text>
        </Pressable>
      </View>
    </MeshBackground>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: space.xxl, gap: space.sm },
  glyph: { fontSize: 44, marginBottom: space.md },
  input: { width: "100%", height: 52, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, fontFamily: fonts.body, fontSize: 16, marginTop: space.xl },
  btn: { width: "100%", height: 52, borderRadius: radius.xl, alignItems: "center", justifyContent: "center", marginTop: space.md },
});
