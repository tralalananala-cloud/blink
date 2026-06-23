import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { space } from "../theme/tokens";
import { fonts } from "../theme/typography";
import { useTheme } from "../theme/ThemeProvider";

const GROUPS: { key: string; tab: string; emojis: string[] }[] = [
  {
    key: "smileys",
    tab: "😀",
    emojis: "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😜 🤪 😝 🤗 🤭 🤔 🤨 😐 😑 😶 🙄 😏 😣 😥 😮 🤐 😯 😪 😫 🥱 😴 😌 😛 😎 🥳 🤩 🥺 😢 😭 😤 😠 😡 🤬 😱 😨 😰 😥 🤯 😳".split(" "),
  },
  { key: "gestures", tab: "👍", emojis: "👍 👎 👌 ✌️ 🤞 🤟 🤘 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 🤙 💪 🙏 🤝 👏 🙌 👐 🤲 ✊ 👊 🫶 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 ❤️‍🔥 💯 🔥 ⭐ ✨ ⚡".split(" ") },
  { key: "objects", tab: "🔒", emojis: "🔒 🔓 🔑 🗝️ 🛡️ ⚙️ 💻 📱 📷 🎥 🎙️ 📎 📁 📄 ✅ ❌ ⚠️ 🚀 🎉 🎊 💬 📡 🌐 🔗 ⬡ 👁️ 🕵️ 🥷 💾 📍".split(" ") },
];

export function EmojiPicker({ onPick }: { onPick: (e: string) => void }) {
  const { colors } = useTheme();
  const [tab, setTab] = useState(0);
  return (
    <View style={[styles.root, { backgroundColor: colors.bgRaised, borderTopColor: colors.border }]}>
      <ScrollView contentContainerStyle={styles.grid} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="always">
        {GROUPS[tab].emojis.map((e, i) => (
          <Pressable key={i} onPress={() => onPick(e)} style={styles.cell}>
            <Text style={styles.emoji}>{e}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <View style={[styles.tabs, { borderTopColor: colors.border }]}>
        {GROUPS.map((g, i) => (
          <Pressable key={g.key} onPress={() => setTab(i)} style={[styles.tab, i === tab && { backgroundColor: colors.surface }]}>
            <Text style={styles.emoji}>{g.tab}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { height: 260, borderTopWidth: StyleSheet.hairlineWidth },
  grid: { flexDirection: "row", flexWrap: "wrap", padding: space.sm },
  cell: { width: `${100 / 8}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  emoji: { fontSize: 26, fontFamily: fonts.body },
  tabs: { flexDirection: "row", borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.sm, paddingVertical: 4 },
  tab: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 10, marginRight: 6 },
});
