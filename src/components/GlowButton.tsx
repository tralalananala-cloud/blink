import React from "react";
import { Pressable, StyleSheet, Text, ViewStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { radius, space } from "../theme/tokens";
import { fonts } from "../theme/typography";
import { useTheme } from "../theme/ThemeProvider";

type Variant = "primary" | "accent" | "ghost" | "danger";

interface Props {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  style?: ViewStyle;
}

export function GlowButton({ label, onPress, variant = "primary", disabled, style }: Props) {
  const { colors } = useTheme();
  const handle = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    onPress?.();
  };

  const variants: Record<Variant, { bg: string; fg: string; border: string }> = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    accent: { bg: "transparent", fg: colors.accent, border: colors.accent },
    ghost: { bg: "transparent", fg: colors.textSecondary, border: colors.border },
    danger: { bg: "transparent", fg: colors.danger, border: colors.danger },
  };
  const v = variants[variant];
  const glow =
    colors.glowOn && variant === "primary"
      ? { shadowColor: colors.primary, shadowOpacity: 0.55, shadowRadius: 16, shadowOffset: { width: 0, height: 0 }, elevation: 8 }
      : colors.glowOn && variant === "accent"
      ? { shadowColor: colors.accent, shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 0 }, elevation: 6 }
      : null;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={handle}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: v.bg, borderColor: v.border },
        glow,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.label, { color: v.fg }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    borderRadius: radius.xl,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.xl,
  },
  label: { fontFamily: fonts.bodySemibold, fontSize: 15, letterSpacing: 0.3 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  disabled: { opacity: 0.4 },
});
