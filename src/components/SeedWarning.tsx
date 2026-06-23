/**
 * Avertisment anti-phishing afișat oriunde apar cuvintele frazei de recuperare.
 *
 * Cea mai frecventă „spargere" a unui wallet/messenger nu sparge cripto, ci păcălește
 * omul să-și dezvăluie seed-ul (fals admin/suport/prieten, „verificare", „premiu").
 * Mesajul: fraza NU se cere NICIODATĂ de nimeni — cine o cere te înșală. Educația e
 * singura apărare împotriva acestui vector (niciun crypto nu te apără aici).
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme/ThemeProvider";
import { fonts } from "../theme/typography";
import { radius, space } from "../theme/tokens";
import { useI18n } from "../i18n";
import { Icon } from "./Icon";

export function SeedWarning() {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={[styles.box, { backgroundColor: colors.glowDanger, borderColor: colors.warning }]}>
      <Icon name="shield" size={18} color={colors.warning} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.warning }]}>{t.seedWarning.title}</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{t.seedWarning.body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: "row", gap: space.sm, alignItems: "flex-start",
    borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg,
    padding: space.md, marginTop: space.md,
  },
  title: { fontFamily: fonts.bodySemibold, fontSize: 13, marginBottom: 2 },
  body: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17 },
});
