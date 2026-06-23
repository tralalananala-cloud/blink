import React from "react";
import { StyleSheet, View, ViewProps, ViewStyle } from "react-native";
import { radius, space } from "../theme/tokens";
import { useTheme } from "../theme/ThemeProvider";

/** Card 2xl cu margine subtila, baza estetica a UI-ului. */
export function Card({ style, children, ...rest }: ViewProps & { style?: ViewStyle }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.bgRaised,
          borderRadius: radius["2xl"],
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          padding: space.lg,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}
