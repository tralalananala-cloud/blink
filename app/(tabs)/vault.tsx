import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import QRCode from "react-native-qrcode-svg";
import { Screen } from "../../src/components/Screen";
import { Card } from "../../src/components/Card";
import { GlowButton } from "../../src/components/GlowButton";
import { SeedWarning } from "../../src/components/SeedWarning";
import { radius, space } from "../../src/theme/tokens";
import { fonts } from "../../src/theme/typography";
import { useTheme, useType } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { useApp } from "../../src/state/store";
import { engine } from "../../src/crypto";

/** QR real, scanabil, care encodează DID-ul (fundal alb pt contrast maxim). */
function DidQR({ value }: { value: string }) {
  return (
    <View style={styles.qr}>
      <QRCode value={value} size={184} color="#0A0C10" backgroundColor="#FFFFFF" ecl="M" />
    </View>
  );
}

export default function Vault() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const type = useType();
  const identity = useApp((s) => s.identity);
  const [phrase, setPhrase] = useState<string[]>([]);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    engine.exportRecoveryPhrase().then(setPhrase);
  }, []);

  if (!identity) return <Screen title={t.vault.title}><Text style={type.bodyMuted}>—</Text></Screen>;

  return (
    <Screen title={t.vault.title}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.xxxl }}>
        <Card>
          <Text style={[styles.section, { color: colors.textPrimary }]}>{t.vault.identityKey}</Text>
          <Text style={[styles.kLabel, { color: colors.textMuted }]}>{t.vault.fingerprint}</Text>
          <Text style={[styles.fingerprint, { color: colors.primary }]}>{identity.fingerprint}</Text>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Text style={[styles.kLabel, { color: colors.textMuted }]}>{t.vault.did}</Text>
          <Text style={[styles.mono, { color: colors.textSecondary }]}>{identity.did}</Text>
        </Card>

        <Card style={{ marginTop: space.lg }}>
          <View style={styles.cardHead}>
            <Text style={[styles.section, { color: colors.textPrimary }]}>{t.vault.recovery}</Text>
            <GlowButton label={revealed ? t.vault.hide : t.vault.reveal} variant="accent" onPress={() => { Haptics.selectionAsync().catch(() => {}); setRevealed((v) => !v); }} style={{ height: 34, paddingHorizontal: space.md }} />
          </View>
          {revealed ? <SeedWarning /> : null}
          <View style={styles.grid}>
            {phrase.map((w, i) => (
              <View key={i} style={[styles.word, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[styles.wordIdx, { color: colors.textMuted }]}>{i + 1}</Text>
                <Text style={[styles.wordText, { color: colors.textPrimary }]}>{revealed ? w : "••••"}</Text>
              </View>
            ))}
          </View>
        </Card>

        <Card style={{ marginTop: space.lg, alignItems: "center" }}>
          <Text style={[styles.section, { color: colors.textPrimary, alignSelf: "flex-start" }]}>{t.vault.pairDevice}</Text>
          <Text style={[type.caption, { alignSelf: "flex-start", marginBottom: space.md }]}>{t.vault.pairBody}</Text>
          <DidQR value={identity.did} />
        </Card>

        <Card style={{ marginTop: space.lg }}>
          <Text style={[styles.section, { color: colors.textPrimary }]}>{t.vault.backup}</Text>
          <Text style={[type.caption, { marginBottom: space.md }]}>{t.vault.backupBody}</Text>
          <GlowButton label={t.vault.backupNow} onPress={() => {}} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { fontFamily: fonts.display, fontSize: 16, marginBottom: space.sm },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  kLabel: { fontFamily: fonts.monoMedium, fontSize: 10, letterSpacing: 1, marginTop: space.sm },
  fingerprint: { fontFamily: fonts.monoMedium, fontSize: 17, letterSpacing: 1, marginTop: 4 },
  mono: { fontFamily: fonts.mono, fontSize: 12, marginTop: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: space.md },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginTop: space.sm },
  word: { flexDirection: "row", alignItems: "center", gap: 6, width: "47%", borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.md },
  wordIdx: { fontFamily: fonts.mono, fontSize: 11, width: 18 },
  wordText: { fontFamily: fonts.bodyMedium, fontSize: 14 },
  qr: { padding: space.md, borderRadius: radius.lg, backgroundColor: "#FFFFFF", marginTop: space.sm },
});
