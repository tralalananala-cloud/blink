import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { radius } from "../theme/tokens";
import { fonts } from "../theme/typography";
import { useTheme } from "../theme/ThemeProvider";

/** Avatar identicon-like: initiala + culoare derivata din DID. */
export function Avatar({ name, did, size = 48, group }: { name: string; did: string; size?: number; group?: boolean }) {
  const { colors, dark } = useTheme();
  const pairs = [
    { bg: dark ? "#13241B" : "#E7F6EC", fg: colors.secure },
    { bg: dark ? "#102430" : "#E5F1FB", fg: colors.accent },
    { bg: dark ? "#1E2410" : "#F0F4E8", fg: colors.primaryDim },
    { bg: dark ? "#241A10" : "#FBF0E0", fg: colors.warning },
  ];
  let h = 0;
  for (const c of did) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = pairs[h % pairs.length];
  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <View
      style={[
        styles.root,
        {
          width: size,
          height: size,
          borderRadius: group ? radius.lg : size / 2,
          backgroundColor: hue.bg,
          borderColor: hue.fg,
        },
      ]}
    >
      <Text style={[styles.initial, { color: hue.fg, fontSize: size * 0.4 }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth },
  initial: { fontFamily: fonts.display },
});
