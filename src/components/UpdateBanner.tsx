import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Linking from "expo-linking";
import { checkForUpdate, UpdateInfo } from "../update/checker";
import { radius, space } from "../theme/tokens";
import { fonts } from "../theme/typography";
import { useTheme } from "../theme/ThemeProvider";

/**
 * Banner discret care apare DOAR dacă există o versiune mai nouă pe GitHub.
 * Tap → deschide APK-ul în browser (Android cere apoi consimțământ de instalare;
 * aceeași semnătură CN=Blink → se instalează peste, identitatea se păstrează).
 */
export function UpdateBanner() {
  const { colors } = useTheme();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let alive = true;
    checkForUpdate().then((u) => { if (alive) setInfo(u); });
    return () => { alive = false; };
  }, []);

  if (!info || dismissed) return null;

  return (
    <Pressable
      onPress={() => Linking.openURL(info.url).catch(() => {})}
      style={[styles.banner, { backgroundColor: colors.bgRaised, borderColor: colors.accent }]}
    >
      <Text style={[styles.icon, { color: colors.accent }]}>⬆</Text>
      <Text style={[styles.text, { color: colors.accent }]}>Blink {info.version} available — tap to update</Text>
      <Pressable hitSlop={10} onPress={() => setDismissed(true)}>
        <Text style={[styles.close, { color: colors.textMuted }]}>✕</Text>
      </Pressable>
    </Pressable>
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
  close: { fontSize: 13 },
});
