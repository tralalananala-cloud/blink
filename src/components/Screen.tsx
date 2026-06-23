import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MeshBackground } from "./MeshBackground";
import { space } from "../theme/tokens";
import { useType } from "../theme/ThemeProvider";

/** Container de ecran: mesh background + safe area + titlu optional. */
export function Screen({
  title,
  right,
  children,
  noPadding,
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  scroll?: boolean;
  noPadding?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const type = useType();
  return (
    <MeshBackground>
      <View style={{ paddingTop: insets.top, flex: 1 }}>
        {title ? (
          <View style={styles.header}>
            <Text style={type.h1}>{title}</Text>
            {right}
          </View>
        ) : null}
        <View style={[{ flex: 1 }, !noPadding && { paddingHorizontal: space.lg }]}>{children}</View>
      </View>
    </MeshBackground>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.md,
  },
});
