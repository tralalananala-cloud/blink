import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { radius, space } from "../theme/tokens";
import { fonts } from "../theme/typography";
import { PeerStatus } from "../transport/types";
import { useI18n } from "../i18n";
import { useTheme } from "../theme/ThemeProvider";

/** Badge "verificat" discret. */
export function VerifiedBadge({ verified, label }: { verified: boolean; label?: string }) {
  const { colors } = useTheme();
  const color = verified ? colors.secure : colors.textMuted;
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      {label ? <Text style={[styles.pillText, { color }]}>{label}</Text> : null}
    </View>
  );
}

/** Indicator de stare peer / mesh (direct / releu / mesh / offline). */
export function PeerStatusBadge({ status }: { status: PeerStatus }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const map: Record<PeerStatus, string> = {
    direct: colors.secure,
    relay: colors.accent,
    mesh: colors.warning,
    offline: colors.textMuted,
  };
  const color = map[status];
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.pillText, { color }]}>{t.peer[status]}</Text>
    </View>
  );
}

/** Bula de unread. */
export function UnreadBadge({ count }: { count: number }) {
  const { colors } = useTheme();
  if (count <= 0) return null;
  return (
    <View style={[styles.unread, { backgroundColor: colors.primary }]}>
      <Text style={[styles.unreadText, { color: colors.onPrimary }]}>{count}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.full,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontFamily: fonts.bodyMedium, fontSize: 11, letterSpacing: 0.3 },
  unread: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: radius.full, alignItems: "center", justifyContent: "center" },
  unreadText: { fontFamily: fonts.bodySemibold, fontSize: 12 },
});
