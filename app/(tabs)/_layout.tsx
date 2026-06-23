import React from "react";
import { Tabs } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { space } from "../../src/theme/tokens";
import { fonts } from "../../src/theme/typography";
import { useI18n } from "../../src/i18n";
import { useTheme } from "../../src/theme/ThemeProvider";
import { Icon } from "../../src/components/Icon";

const GLYPH: Record<string, string> = { chats: "chatbubbles", contacts: "people", vault: "shield", settings: "settings" };

function TabIcon({ name, label, focused }: { name: string; label: string; focused: boolean }) {
  const { colors } = useTheme();
  const color = focused ? colors.primary : colors.textMuted;
  return (
    <View style={styles.tab}>
      <Icon name={GLYPH[name]} size={22} color={color} />
      <Text style={[styles.label, { color }]}>{label}</Text>
      {focused ? <View style={[styles.activeDot, { backgroundColor: colors.primary }]} /> : <View style={styles.dotPlaceholder} />}
    </View>
  );
}

export default function TabsLayout() {
  const { t } = useI18n();
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.bgRaised, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, height: 68, paddingTop: space.sm },
      }}
    >
      <Tabs.Screen name="chats" options={{ tabBarIcon: ({ focused }) => <TabIcon name="chats" label={t.tabs.chats} focused={focused} /> }} />
      <Tabs.Screen name="contacts" options={{ tabBarIcon: ({ focused }) => <TabIcon name="contacts" label={t.tabs.contacts} focused={focused} /> }} />
      <Tabs.Screen name="vault" options={{ tabBarIcon: ({ focused }) => <TabIcon name="vault" label={t.tabs.vault} focused={focused} /> }} />
      <Tabs.Screen name="settings" options={{ tabBarIcon: ({ focused }) => <TabIcon name="settings" label={t.tabs.settings} focused={focused} /> }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tab: { alignItems: "center", justifyContent: "center", width: 72, gap: 2 },
  glyph: { fontSize: 20 },
  label: { fontFamily: fonts.bodyMedium, fontSize: 10, letterSpacing: 0.2 },
  activeDot: { width: 4, height: 4, borderRadius: 2, marginTop: 2 },
  dotPlaceholder: { width: 4, height: 4, marginTop: 2 },
});
