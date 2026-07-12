import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";
import { confirmDestructive } from "../../src/ui/confirm";
import { currentVersion } from "../../src/update/checker";
import { LinearGradient } from "expo-linear-gradient";
import * as ScreenCapture from "expo-screen-capture";
import { PasscodeModal } from "../../src/components/PasscodeModal";
import { clearAppPasscode, hasAppPasscode, setAppPasscode, wipeAllSecrets } from "../../src/security/lock";
import { relay } from "../../src/messaging/relay";
import { setupNotifications, notifyMessage } from "../../src/notify";
import { Screen } from "../../src/components/Screen";
import { Card } from "../../src/components/Card";
import { SettingRow } from "../../src/components/Row";
import { GlowButton } from "../../src/components/GlowButton";
import { radius, space } from "../../src/theme/tokens";
import { fonts } from "../../src/theme/typography";
import { useTheme, useType } from "../../src/theme/ThemeProvider";
import { useI18n, Lang } from "../../src/i18n";
import { useApp, ThemeName } from "../../src/state/store";
import { engine } from "../../src/crypto";
import { RETICULUM_GATEWAY } from "../../src/config";
import { themes } from "../../src/theme/themes";

const THEME_ORDER: ThemeName[] = ["cipher", "messenger", "telegram", "abyss", "nebula"];

export default function Settings() {
  const { t, lang, setLang } = useI18n();
  const { colors } = useTheme();
  const type = useType();
  const settings = useApp((s) => s.settings);
  const update = useApp((s) => s.updateSettings);
  const wipe = useApp((s) => s.wipe);
  const [appLock, setAppLock] = useState(false);
  const [pwModal, setPwModal] = useState(false);

  useEffect(() => { hasAppPasscode().then(setAppLock); }, []);

  // Releul criptat e transportul de bază, mereu pornit — starea veche cu alt "mode" se normalizează.
  useEffect(() => {
    if (settings.transportMode !== "p2p") update({ transportMode: "p2p" });
  }, [settings.transportMode]);

  function toggleAppLock(v: boolean) {
    if (v) setPwModal(true);
    else {
      confirmDestructive(t.lock.removePassword, "", t.lock.removePassword, async () => { await clearAppPasscode(); setAppLock(false); }, t.common.cancel);
    }
  }

  function setScreenshotBlocker(v: boolean) {
    update({ screenshotBlocker: v });
    (v ? ScreenCapture.preventScreenCaptureAsync() : ScreenCapture.allowScreenCaptureAsync()).catch(() => {});
  }

  function confirmWipe() {
    confirmDestructive(t.settings.wipe, t.settings.wipeBody, t.settings.wipe, async () => {
      // B2 — wipe corect: anunță releul (șterge DID vechi), golește memoria crypto,
      // șterge TOATE secretele din SecureStore, abia apoi resetează datele + UI.
      const convIds = useApp.getState().conversations.map((c) => c.id);
      relay.deregister();
      engine.clearIdentity?.();
      await wipeAllSecrets(convIds);
      wipe();
      router.replace("/onboarding");
    }, t.common.cancel);
  }

  const sectionStyle = [styles.section, { color: colors.textPrimary }];
  const seg = (active: boolean) => [styles.seg, { color: active ? colors.primary : colors.textSecondary }, active && { backgroundColor: colors.bgRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.primary }];

  return (
    <Screen title={t.settings.title}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.xxxl, gap: space.lg }}>
        {/* Profil — numele/pseudonimul tău (apare la ceilalți) */}
        <Card>
          <Text style={sectionStyle}>{t.settings.profile}</Text>
          <Text style={[type.caption, { marginBottom: space.sm }]}>{t.settings.profileBody}</Text>
          <TextInput
            value={settings.profileName}
            onChangeText={(v) => update({ profileName: v.slice(0, 32) })}
            placeholder={t.settings.profilePlaceholder}
            placeholderTextColor={colors.textMuted}
            style={[styles.nameInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary }]}
            maxLength={32}
          />
        </Card>

        {/* Appearance / teme */}
        <Card>
          <Text style={sectionStyle}>{t.settings.appearance}</Text>
          <Text style={[type.caption, { marginBottom: space.sm }]}>{t.settings.appearanceBody}</Text>
          <View style={styles.themeGrid}>
            {THEME_ORDER.map((name) => {
              const th = themes[name];
              const active = settings.themeName === name;
              const grad = th.colors.bubbleMineGradient;
              return (
                <Pressable key={name} onPress={() => update({ themeName: name })} style={[styles.themeCard, { borderColor: active ? colors.primary : colors.border, backgroundColor: th.colors.bg }]}>
                  <View style={styles.swatch}>
                    <View style={[styles.bubbleMini, { backgroundColor: th.colors.bubbleTheirs, borderColor: th.colors.bubbleTheirsBorder, alignSelf: "flex-start" }]} />
                    {grad ? (
                      <LinearGradient colors={grad as [string, string, ...string[]]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.bubbleMini, { alignSelf: "flex-end" }]} />
                    ) : (
                      <View style={[styles.bubbleMini, { backgroundColor: th.colors.bubbleMine, alignSelf: "flex-end" }]} />
                    )}
                    <View style={[styles.dotMini, { backgroundColor: th.colors.primary }]} />
                  </View>
                  <Text style={[styles.themeLabel, { color: th.colors.textPrimary }]} numberOfLines={1}>{th.label}</Text>
                  {active ? <View style={[styles.themeCheck, { backgroundColor: colors.primary }]}><Text style={{ color: colors.onPrimary, fontSize: 10 }}>✓</Text></View> : null}
                </Pressable>
              );
            })}
          </View>
        </Card>

        {/* Transport */}
        <Card>
          <Text style={sectionStyle}>{t.settings.transport}</Text>
          <Text style={[type.caption, { marginBottom: space.sm }]}>{t.settings.transportBody}</Text>

          {/* Reticulum (experimental) — transport descentralizat prin gateway, decuplat de releu */}
          <SettingRow
            title={t.settings.reticulum}
            subtitle={t.settings.reticulumBody}
            value={!!settings.reticulumEnabled}
            onValueChange={(v) => {
              // blocăm doar dacă nu există NICIO adresă (nici în câmp, nici fallback-ul din build)
              if (v && !(settings.reticulumGateway ?? "").trim() && !RETICULUM_GATEWAY) { notifyMessage("Blink", t.settings.reticulumOnNoAddr); return; }
              update({ reticulumEnabled: v });
              relay.refreshReticulum();
            }}
          />
          {/* Adresa gateway-ului — MEREU vizibilă: o pui ÎNTÂI, apoi pornești toggle-ul. */}
          <TextInput
            value={settings.reticulumGateway ?? ""}
            onChangeText={(gw) => update({ reticulumGateway: gw })}
            onBlur={() => relay.refreshReticulum()}
            placeholder={t.settings.reticulumGatewayPlaceholder}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={[styles.reticulumInput, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary }]}
          />

          {/* BLE mesh (experimental) — telefon↔telefon prin Bluetooth, fără internet (v1: proximitate) */}
          <SettingRow
            title={t.settings.bleMesh}
            subtitle={t.settings.bleMeshBody}
            value={!!settings.bleMeshEnabled}
            onValueChange={(v) => {
              update({ bleMeshEnabled: v });
              relay.refreshBleMesh();
            }}
          />
        </Card>

        {/* Privacy */}
        <Card>
          <Text style={sectionStyle}>{t.settings.privacy}</Text>
          <SettingRow
            title={t.settings.notifications}
            subtitle={t.settings.notificationsBody}
            value={settings.notifications}
            onValueChange={(v) => {
              update({ notifications: v });
              if (v) setupNotifications().then((ok) => { if (ok) notifyMessage("Blink", t.settings.notificationsBody); });
            }}
          />
          <SettingRow title={t.settings.sealedSender} subtitle={t.settings.sealedSenderBody} value={settings.sealedSender} onValueChange={(v) => update({ sealedSender: v })} />
          <SettingRow title={t.settings.screenshotBlocker} subtitle={t.settings.screenshotBlockerBody} value={settings.screenshotBlocker} onValueChange={setScreenshotBlocker} />
        </Card>

        {/* Security */}
        <Card>
          <Text style={sectionStyle}>{t.settings.security}</Text>
          <SettingRow
            title={t.settings.engineStatus}
            subtitle={engine.name}
            right={(() => {
              const c = engine.isAudited ? colors.secure : engine.isSecure ? colors.warning : colors.danger;
              const label = engine.isAudited ? "AUDITED" : engine.isSecure ? "REAL" : "MOCK";
              return (
                <View style={[styles.statusPill, { borderColor: c }]}>
                  <Text style={{ fontFamily: fonts.monoMedium, fontSize: 11, color: c }}>{label}</Text>
                </View>
              );
            })()}
          />
          <SettingRow title={t.lock.appLock} subtitle={t.lock.appLockBody} value={appLock} onValueChange={toggleAppLock} />
          {appLock ? (
            <Pressable onPress={() => setPwModal(true)}>
              <Text style={{ color: colors.accent, fontFamily: fonts.bodyMedium, fontSize: 13, paddingVertical: space.xs }}>{t.lock.changePassword}</Text>
            </Pressable>
          ) : null}
        </Card>

        {/* Language */}
        <Card>
          <Text style={sectionStyle}>{t.settings.language}</Text>
          <View style={[styles.segment, { backgroundColor: colors.surface }]}>
            {(["ro", "en"] as Lang[]).map((l) => (
              <Text key={l} onPress={() => setLang(l)} style={seg(lang === l)}>{l.toUpperCase()}</Text>
            ))}
          </View>
        </Card>

        {/* Danger */}
        <Card style={{ borderColor: colors.danger }}>
          <Text style={[styles.section, { color: colors.danger }]}>{t.settings.danger}</Text>
          <GlowButton label={t.settings.wipe} variant="danger" onPress={confirmWipe} />
        </Card>

        {/* Version footer — tap deschide pagina de releases */}
        <Pressable
          onPress={() => Linking.openURL("https://github.com/tralalananala-cloud/blink/releases").catch(() => {})}
          style={{ alignItems: "center", paddingVertical: space.lg }}
        >
          <Text style={{ fontFamily: fonts.monoMedium, fontSize: 12, color: colors.textMuted }}>
            Blink v{currentVersion()}
          </Text>
        </Pressable>
      </ScrollView>

      <PasscodeModal
        visible={pwModal}
        mode="set"
        title={appLock ? t.lock.changePassword : t.lock.setPassword}
        subtitle={t.lock.appLockBody}
        onCancel={() => setPwModal(false)}
        onSubmit={async (pin) => { await setAppPasscode(pin); setAppLock(true); setPwModal(false); return true; }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { fontFamily: fonts.display, fontSize: 16, marginBottom: space.xs },
  nameInput: { height: 48, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, fontFamily: fonts.body, fontSize: 15 },
  segment: { flexDirection: "row", gap: space.sm, marginVertical: space.sm, borderRadius: radius.lg, padding: 4 },
  reticulumInput: { marginTop: space.sm, height: 44, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, fontFamily: fonts.mono, fontSize: 13 },
  seg: { flex: 1, textAlign: "center", paddingVertical: space.sm, borderRadius: radius.md, fontFamily: fonts.bodyMedium, fontSize: 13, overflow: "hidden" },
  statusPill: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.full, paddingHorizontal: space.sm, paddingVertical: 3 },
  themeGrid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  themeCard: { width: "31.5%", borderWidth: 1.5, borderRadius: radius.lg, padding: space.sm, height: 96, justifyContent: "space-between" },
  swatch: { flex: 1, justifyContent: "center", gap: 4 },
  bubbleMini: { width: 34, height: 12, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth },
  dotMini: { width: 10, height: 10, borderRadius: 5, position: "absolute", right: 2, bottom: 2 },
  themeLabel: { fontFamily: fonts.bodySemibold, fontSize: 12, marginTop: 4 },
  themeCheck: { position: "absolute", top: 6, right: 6, width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
});
