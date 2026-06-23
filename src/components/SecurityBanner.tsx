import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { radius, space } from "../theme/tokens";
import { fonts } from "../theme/typography";
import { engine } from "../crypto";
import { useI18n } from "../i18n";
import { useTheme } from "../theme/ThemeProvider";

/**
 * Banner onest despre starea criptografiei:
 * - motor nesigur (mock)            -> roșu, „nu trimite secrete reale"
 * - real dar needuitat (Signal noble) -> galben, „build needuitat"
 * - real + auditat (libsignal nativ)  -> ascuns
 */
export function SecurityBanner() {
  const { t } = useI18n();
  const { colors } = useTheme();
  if (engine.isSecure && engine.isAudited) return null;

  const real = engine.isSecure;
  const color = real ? colors.warning : colors.danger;
  const msg = real ? t.security.experimentalBanner : t.security.insecureBanner;

  return (
    <View style={[styles.banner, { backgroundColor: real ? "rgba(245,185,60,0.10)" : colors.glowDanger, borderColor: color }]}>
      <Text style={[styles.icon, { color }]}>{real ? "🛡" : "⚠"}</Text>
      <Text style={[styles.text, { color }]}>{msg}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  icon: { fontSize: 14 },
  text: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 12, lineHeight: 16 },
});
