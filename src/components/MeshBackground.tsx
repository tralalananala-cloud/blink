import React from "react";
import { StyleSheet, View, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "../theme/ThemeProvider";

/**
 * Fundal cu gradient "mesh". Pe tema cipher = plasă întunecată; pe temele
 * light (messenger/telegram) gradientele devin subtile/uniforme.
 */
export function MeshBackground({ children, style }: { children?: React.ReactNode; style?: ViewStyle }) {
  const { colors } = useTheme();
  return (
    <View style={[{ flex: 1, backgroundColor: colors.bg }, style]}>
      <LinearGradient
        colors={[colors.meshA, "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.9, y: 0.7 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={["transparent", colors.meshB]}
        start={{ x: 1, y: 0 }}
        end={{ x: 0.2, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {children}
    </View>
  );
}
