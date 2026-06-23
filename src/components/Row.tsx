import React from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { space } from "../theme/tokens";
import { useTheme, useType } from "../theme/ThemeProvider";

/** Rand de setare cu titlu + subtitlu + control (switch sau accesoriu). */
export function SettingRow({
  title,
  subtitle,
  value,
  onValueChange,
  right,
  onPress,
  danger,
  disabled,
}: {
  title: string;
  subtitle?: string;
  value?: boolean;
  onValueChange?: (v: boolean) => void;
  right?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const type = useType();
  const Wrapper: any = onPress && !disabled ? Pressable : View;
  return (
    <Wrapper onPress={disabled ? undefined : onPress} style={[styles.row, disabled && styles.disabled]}>
      <View style={styles.texts}>
        <Text style={[type.body, danger && { color: colors.danger }]}>{title}</Text>
        {subtitle ? <Text style={type.caption}>{subtitle}</Text> : null}
      </View>
      {onValueChange ? (
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ false: colors.surfaceAlt, true: colors.primaryDim }}
          thumbColor={value ? colors.primary : colors.textMuted}
        />
      ) : (
        right ?? null
      )}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: space.md, gap: space.lg },
  texts: { flex: 1, gap: 2 },
  disabled: { opacity: 0.4 },
});
