import React, { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { radius, space } from "../theme/tokens";
import { fonts } from "../theme/typography";
import { useTheme, useType } from "../theme/ThemeProvider";
import { useI18n, format } from "../i18n";
import { useApp } from "../state/store";
import { announceGroup } from "../messaging/group";
import { Avatar } from "./Avatar";

export function NewGroupModal({ visible, onClose, onCreated }: { visible: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { colors } = useTheme();
  const type = useType();
  const { t } = useI18n();
  const contacts = useApp((s) => s.contacts);
  const createGroup = useApp((s) => s.createGroup);
  const [name, setName] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());

  function toggle(did: string) {
    Haptics.selectionAsync().catch(() => {});
    setSel((prev) => {
      const next = new Set(prev);
      next.has(did) ? next.delete(did) : next.add(did);
      return next;
    });
  }
  function close() { setName(""); setSel(new Set()); onClose(); }
  function create() {
    if (sel.size < 2) return;
    const id = createGroup(name, [...sel]);
    announceGroup(id); // gc:create către toți membrii (roster complet + nume) — fan-out G3
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    close();
    onCreated(id);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.bgRaised, borderColor: colors.border }]} onPress={() => {}}>
          <View style={[styles.grip, { backgroundColor: colors.border }]} />
          <Text style={type.h2}>{t.friends.newGroup}</Text>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t.friends.groupName}
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary }]}
          />

          <Text style={[type.label, { marginTop: space.lg, marginBottom: space.sm }]}>
            {t.friends.selectMembers} · {format(t.friends.membersCount, { n: sel.size })}
          </Text>

          <FlatList
            data={contacts}
            keyExtractor={(c) => c.did}
            style={{ maxHeight: 280 }}
            renderItem={({ item }) => {
              const on = sel.has(item.did);
              return (
                <Pressable style={styles.row} onPress={() => toggle(item.did)}>
                  <Avatar name={item.name} did={item.did} size={40} />
                  <Text style={[styles.name, { color: colors.textPrimary }]}>{item.name}</Text>
                  <View style={[styles.check, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : "transparent" }]}>
                    {on ? <Text style={{ color: colors.onPrimary, fontSize: 13 }}>✓</Text> : null}
                  </View>
                </Pressable>
              );
            }}
          />

          <Text style={[type.caption, { marginTop: space.sm }]}>{t.friends.groupE2E}</Text>

          <Pressable onPress={create} disabled={sel.size < 2} style={[styles.createBtn, { backgroundColor: colors.primary, opacity: sel.size < 2 ? 0.4 : 1 }]}>
            <Text style={{ color: colors.onPrimary, fontFamily: fonts.bodySemibold, fontSize: 15 }}>
              {sel.size < 2 ? t.friends.needTwo : t.friends.create}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: radius["2xl"], borderTopRightRadius: radius["2xl"], borderWidth: StyleSheet.hairlineWidth, padding: space.lg, paddingBottom: space.xxxl },
  grip: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: space.md },
  input: { height: 50, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, fontFamily: fonts.body, fontSize: 15, marginTop: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  name: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 15 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  createBtn: { height: 52, borderRadius: radius.xl, alignItems: "center", justifyContent: "center", marginTop: space.lg },
});
