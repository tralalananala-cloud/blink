/** Meniul de atașamente (prezentațional) — props in, JSX out. Acțiunea de pick e injectată. */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeProvider";
import { radius, space } from "../../theme/tokens";
import { fonts } from "../../theme/typography";
import { Attachment } from "../../data/mockData";
import { pickFile, pickImage, pickVideo, takePhoto } from "../../media/actions";

const ATTACH_ACTIONS = [
  { key: "image", glyph: "🖼️", label: "Poză", run: pickImage },
  { key: "photo", glyph: "📷", label: "Fotografiază", run: takePhoto },
  { key: "video", glyph: "🎞️", label: "Video", run: pickVideo },
  { key: "file", glyph: "📎", label: "Fișier", run: pickFile },
] as const;

export function AttachMenu({ onPick }: { onPick: (run: () => Promise<Attachment | null>) => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.attachMenu, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
      {ATTACH_ACTIONS.map((a) => (
        <Pressable key={a.key} style={styles.attachItem} onPress={() => onPick(a.run)}>
          <View style={[styles.attachIcon, { backgroundColor: colors.surface }]}>
            <Text style={{ fontSize: 24 }}>{a.glyph}</Text>
          </View>
          <Text style={[styles.attachLabel, { color: colors.textSecondary }]}>{a.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  attachMenu: { flexDirection: "row", flexWrap: "wrap", gap: space.lg, padding: space.lg, marginHorizontal: space.md, marginBottom: space.sm, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, justifyContent: "space-around" },
  attachItem: { alignItems: "center", gap: 6, width: 64 },
  attachIcon: { width: 52, height: 52, borderRadius: radius.lg, alignItems: "center", justifyContent: "center" },
  attachLabel: { fontFamily: fonts.bodyMedium, fontSize: 11 },
});
