import React, { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { confirmDestructive } from "../../src/ui/confirm";
import { Icon } from "../../src/components/Icon";
import { Screen } from "../../src/components/Screen";
import { Avatar } from "../../src/components/Avatar";
import { VerifiedBadge } from "../../src/components/Badges";
import { AddFriendModal } from "../../src/components/AddFriendModal";
import { NewGroupModal } from "../../src/components/NewGroupModal";
import { radius, space } from "../../src/theme/tokens";
import { fonts } from "../../src/theme/typography";
import { useTheme } from "../../src/theme/ThemeProvider";
import { useI18n } from "../../src/i18n";
import { useApp } from "../../src/state/store";
import { Contact } from "../../src/data/mockData";

export default function Contacts() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const contacts = useApp((s) => s.contacts);
  const openDirect = useApp((s) => s.openDirect);
  const deleteContact = useApp((s) => s.deleteContact);
  const [addOpen, setAddOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);

  function startChat(c: Contact) {
    const id = openDirect(c);
    router.push(`/chat/${id}`);
  }

  function confirmDeleteContact(c: Contact) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    confirmDestructive(t.friends.deleteContact, c.name, t.friends.deleteContact, () => deleteContact(c.did));
  }

  return (
    <Screen
      title={t.tabs.contacts}
      right={
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Pressable onPress={() => setGroupOpen(true)} style={[styles.hBtn, { borderColor: colors.border, flexDirection: "row", gap: 6 }]}>
            <Icon name="people" size={15} color={colors.textSecondary} />
            <Text style={[styles.hBtnText, { color: colors.textSecondary }]}>{t.friends.newGroup}</Text>
          </Pressable>
          <Pressable onPress={() => setAddOpen(true)} style={[styles.hBtn, { borderColor: colors.primary, width: 38 }]}>
            <Icon name="add" size={20} color={colors.primary} />
          </Pressable>
        </View>
      }
    >
      <FlatList
        data={contacts}
        keyExtractor={(c) => c.did}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.borderSoft, marginLeft: 56 }} />}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
            onPress={() => startChat(item)}
            onLongPress={() => confirmDeleteContact(item)}
            delayLongPress={300}
          >
            <Avatar name={item.name} did={item.did} size={44} />
            <View style={styles.mid}>
              <View style={styles.line}>
                <Text style={[styles.name, { color: colors.textPrimary }]}>{item.name}</Text>
                <VerifiedBadge verified={item.verified} label={item.verified ? t.common.verified : t.common.unverified} />
              </View>
              <Text style={[styles.did, { color: colors.textMuted }]} numberOfLines={1}>{item.did}</Text>
            </View>
            <Pressable hitSlop={10} onPress={() => confirmDeleteContact(item)} style={styles.delBtn}>
              <Icon name="trash-outline" size={18} color={colors.textMuted} />
            </Pressable>
          </Pressable>
        )}
        contentContainerStyle={{ paddingBottom: space.xl }}
      />

      <AddFriendModal visible={addOpen} onClose={() => setAddOpen(false)} />
      <NewGroupModal visible={groupOpen} onClose={() => setGroupOpen(false)} onCreated={(id) => router.push(`/chat/${id}`)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hBtn: { height: 34, borderRadius: radius.full, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, alignItems: "center", justifyContent: "center" },
  hBtnText: { fontFamily: fonts.bodySemibold, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  mid: { flex: 1, gap: 4 },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm },
  name: { fontFamily: fonts.bodySemibold, fontSize: 15 },
  did: { fontFamily: fonts.mono, fontSize: 11 },
  delBtn: { padding: 8 },
});
