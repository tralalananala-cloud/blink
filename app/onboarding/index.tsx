import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import { Screen } from "../../src/components/Screen";
import { Card } from "../../src/components/Card";
import { GlowButton } from "../../src/components/GlowButton";
import { SeedWarning } from "../../src/components/SeedWarning";
import { SecurityBanner } from "../../src/components/SecurityBanner";
import { colors, radius, space } from "../../src/theme/tokens";
import { fonts, type } from "../../src/theme/typography";
import { useI18n } from "../../src/i18n";
import { engine } from "../../src/crypto";
import { Identity } from "../../src/crypto/types";
import { useApp } from "../../src/state/store";

type Step = "welcome" | "identity" | "recovery" | "biometric" | "restore";

export default function Onboarding() {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("welcome");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [phrase, setPhrase] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [restorePhrase, setRestorePhrase] = useState("");
  const [restoreErr, setRestoreErr] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [generating, setGenerating] = useState(false);
  const setIdentityGlobal = useApp((s) => s.setIdentity);
  const setOnboarded = useApp((s) => s.setOnboarded);
  const update = useApp((s) => s.updateSettings);

  async function generate() {
    if (generating) return;
    setGenerating(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    try {
      const id = await engine.generateIdentity();
      setIdentity(id);
      setIdentityGlobal(id);
      setPhrase(await engine.exportRecoveryPhrase());
      setStep("identity");
    } finally {
      setGenerating(false);
    }
  }

  // B4 — restaurare identitate dintr-o frază de recuperare BIP39
  async function doRestore() {
    setRestoreErr(null);
    setRestoring(true);
    try {
      const id = await engine.restoreIdentity(restorePhrase);
      setIdentity(id);
      setIdentityGlobal(id);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setStep("biometric");
    } catch {
      setRestoreErr(t.onboarding.restoreError);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } finally {
      setRestoring(false);
    }
  }

  async function enableBiometric() {
    try {
      const has = await LocalAuthentication.hasHardwareAsync();
      if (has) {
        await LocalAuthentication.authenticateAsync({
          promptMessage: t.onboarding.bioTitle,
        });
      }
    } catch {
      /* demo: ignoram esecul biometric */
    }
    finish();
  }

  function finish() {
    setOnboarded(true);
    router.replace("/(tabs)/chats");
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={{ marginBottom: space.lg }}>
          <SecurityBanner />
        </View>

        {step === "welcome" && (
          <View style={styles.center}>
            <View style={styles.logoMark}>
              <Text style={styles.logoGlyph}>⬡</Text>
            </View>
            <Text style={[type.h1, styles.brand]}>{t.onboarding.welcomeTitle}</Text>
            <Text style={[type.bodyMuted, styles.tagline]}>{t.onboarding.welcomeTagline}</Text>
            <Card style={{ marginTop: space.xl, width: "100%" }}>
              <Text style={type.body}>{t.onboarding.welcomeBody}</Text>
            </Card>
            <View style={styles.actions}>
              <GlowButton label={generating ? t.common.loading : t.onboarding.getStarted} onPress={generate} disabled={generating} />
              <GlowButton label={t.onboarding.restore} variant="ghost" onPress={() => { setRestoreErr(null); setRestorePhrase(""); setStep("restore"); }} />
            </View>
          </View>
        )}

        {step === "identity" && identity && (
          <View>
            <Text style={type.h2}>{t.onboarding.genTitle}</Text>
            <Text style={[type.bodyMuted, { marginTop: space.sm }]}>{t.onboarding.genBody}</Text>
            <Card style={{ marginTop: space.lg }}>
              <Text style={styles.fpLabel}>FINGERPRINT</Text>
              <Text style={styles.fingerprint}>{identity.fingerprint}</Text>
              <View style={styles.divider} />
              <Text style={styles.fpLabel}>DID</Text>
              <Text style={styles.did}>{identity.did}</Text>
            </Card>
            <Card style={{ marginTop: space.md }}>
              <Text style={styles.fpLabel}>{t.onboarding.nameLabel}</Text>
              <TextInput
                value={name}
                onChangeText={(v) => setName(v.slice(0, 32))}
                placeholder={t.onboarding.namePlaceholder}
                placeholderTextColor={colors.textMuted}
                style={styles.nameInput}
                maxLength={32}
                autoCapitalize="words"
              />
            </Card>
            <View style={styles.actions}>
              <GlowButton label={t.common.continue} onPress={() => { update({ profileName: name.trim() }); setStep("recovery"); }} />
            </View>
          </View>
        )}

        {step === "recovery" && (
          <View>
            <Text style={type.h2}>{t.onboarding.recoveryTitle}</Text>
            <Card style={{ marginTop: space.lg, borderColor: colors.warning }}>
              <Text style={[type.caption, { color: colors.warning }]}>{t.onboarding.recoveryBody}</Text>
            </Card>
            <SeedWarning />
            <View style={styles.grid}>
              {phrase.map((w, i) => (
                <View key={i} style={styles.word}>
                  <Text style={styles.wordIdx}>{i + 1}</Text>
                  <Text style={styles.wordText}>{w}</Text>
                </View>
              ))}
            </View>
            <View style={styles.actions}>
              <GlowButton label={t.onboarding.recoveryConfirm} onPress={() => setStep("biometric")} />
            </View>
          </View>
        )}

        {step === "restore" && (
          <View>
            <Text style={type.h2}>{t.onboarding.restoreTitle}</Text>
            <Text style={[type.bodyMuted, { marginTop: space.sm }]}>{t.onboarding.restoreBody}</Text>
            <Card style={{ marginTop: space.lg }}>
              <TextInput
                value={restorePhrase}
                onChangeText={(v) => { setRestorePhrase(v); setRestoreErr(null); }}
                placeholder={t.onboarding.restorePlaceholder}
                placeholderTextColor={colors.textMuted}
                style={styles.phraseInput}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                textAlignVertical="top"
              />
            </Card>
            {restoreErr ? <Text style={styles.restoreErr}>{restoreErr}</Text> : null}
            <Card style={{ marginTop: space.md, borderColor: colors.warning }}>
              <Text style={[type.caption, { color: colors.warning }]}>{t.onboarding.restoreNote}</Text>
            </Card>
            <View style={styles.actions}>
              <GlowButton
                label={restoring ? t.common.loading : t.onboarding.restoreConfirm}
                onPress={doRestore}
                disabled={restoring || restorePhrase.trim().split(/\s+/).length < 12}
              />
              <GlowButton label={t.common.cancel} variant="ghost" onPress={() => setStep("welcome")} />
            </View>
          </View>
        )}

        {step === "biometric" && (
          <View style={styles.center}>
            <View style={styles.bioMark}>
              <Text style={styles.bioGlyph}>☑</Text>
            </View>
            <Text style={[type.h2, { marginTop: space.lg }]}>{t.onboarding.bioTitle}</Text>
            <Text style={[type.bodyMuted, styles.tagline, { marginTop: space.sm }]}>
              {t.onboarding.bioBody}
            </Text>
            <View style={[styles.actions, { width: "100%" }]}>
              <GlowButton label={t.onboarding.bioEnable} onPress={enableBiometric} />
              <GlowButton label={t.onboarding.bioSkip} variant="ghost" onPress={finish} />
            </View>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: space.lg, paddingBottom: space.xxxl, flexGrow: 1 },
  center: { alignItems: "center", flex: 1, justifyContent: "center", paddingTop: space.xxl },
  logoMark: {
    width: 96,
    height: 96,
    borderRadius: radius["2xl"],
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 10,
  },
  logoGlyph: { fontSize: 52, color: colors.primary },
  brand: { marginTop: space.lg, fontSize: 36 },
  tagline: { textAlign: "center" },
  actions: { marginTop: space.xl, gap: space.md, width: "100%" },
  fpLabel: { fontFamily: fonts.monoMedium, fontSize: 10, color: colors.textMuted, letterSpacing: 1 },
  fingerprint: { fontFamily: fonts.monoMedium, fontSize: 18, color: colors.primary, letterSpacing: 1, marginTop: 6 },
  did: { fontFamily: fonts.mono, fontSize: 12, color: colors.textSecondary, marginTop: 6 },
  nameInput: {
    marginTop: 8,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  phraseInput: {
    minHeight: 96,
    fontFamily: fonts.mono,
    fontSize: 15,
    lineHeight: 24,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  restoreErr: { color: colors.danger, fontFamily: fonts.bodyMedium, fontSize: 13, marginTop: space.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.lg },
  word: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    width: "47%",
    backgroundColor: colors.bgRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  wordIdx: { fontFamily: fonts.mono, fontSize: 11, color: colors.textMuted, width: 18 },
  wordText: { fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.textPrimary },
  bioMark: {
    width: 88,
    height: 88,
    borderRadius: radius.full,
    backgroundColor: colors.bgRaised,
    borderWidth: 1,
    borderColor: colors.secure,
    alignItems: "center",
    justifyContent: "center",
  },
  bioGlyph: { fontSize: 40, color: colors.secure },
});
