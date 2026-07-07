/** Membrii grupului (lot GRUPURI v1) — listă cu insigne admin/tu, adăugare/scoatere (doar
 *  adminul; gărzile reale sunt în applyGroupCtl) și părăsire. Mutațiile pleacă pe sârmă prin
 *  messaging/group (fan-out gc): noii membri primesc roster-ul complet, cei scoși sunt anunțați. */
import React, { useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "../Icon";
import { Avatar } from "../Avatar";
import { useTheme, useType } from "../../theme/ThemeProvider";
import { useI18n, format } from "../../i18n";
import { useApp } from "../../state/store";
import { radius, space } from "../../theme/tokens";
import { fonts } from "../../theme/typography";
import { GROUP_MAX } from "../../messaging/codec";
import { addMembers, leaveGroup, removeMembers } from "../../messaging/group";
import { confirmDestructive } from "../../ui/confirm";

type Props = { visible: boolean; gid: string; insetsBottom: number; onClose: () => void };

export function GroupMembersSheet({ visible, gid, insetsBottom, onClose }: Props) {
  const { colors } = useTheme();
  const type = useType();
  const { t } = useI18n();
  const conv = useApp((s) => s.conversations.find((c) => c.group && c.id === gid));
  const contacts = useApp((s) => s.contacts);
  const myDid = useApp((s) => s.identity?.did);
  const profileName = useApp((s) => s.settings.profileName);
  const [adding, setAdding] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  if (!conv) return null;

  const members = conv.members ?? [];
  const isAdmin = !!myDid && conv.admin === myDid;
  const addable = contacts.filter((c) => !members.includes(c.did));
  const room = GROUP_MAX - members.length;
  const nameOf = (did: string) =>
    did === myDid
      ? (profileName?.trim() || t.friends.youBadge)
      : contacts.find((c) => c.did === did)?.name || did.slice(0, 18) + "…";

  function toggleSel(did: string) {
    setSel((prev) => {
      const next = new Set(prev);
      next.has(did) ? next.delete(did) : next.add(did);
      return next;
    });
  }
  function confirmAdd() {
    if (sel.size) addMembers(gid, [...sel].slice(0, Math.max(room, 0)));
    setSel(new Set());
    setAdding(false);
  }
  function onLeave() {
    confirmDestructive(t.friends.leaveGroup, t.friends.leaveWarn, t.friends.leaveConfirm, () => {
      leaveGroup(gid);
      onClose();
    }, t.common.cancel);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.bgRaised, borderColor: colors.border, paddingBottom: insetsBottom + space.lg }]} onPress={() => {}}>
          <View style={[styles.grip, { backgroundColor: colors.border }]} />
          <Text style={type.h3}>{t.friends.membersTitle} · {format(t.friends.membersCount, { n: members.length })}</Text>
          <Text style={[type.caption, { marginTop: 2 }]}>{t.friends.groupE2E}</Text>

          <FlatList
            data={members}
            keyExtractor={(d) => d}
            style={{ maxHeight: 300, marginTop: space.md }}
            renderItem={({ item: did }) => (
              <View style={styles.row}>
                <Avatar name={nameOf(did)} did={did} size={36} />
                <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={1}>{nameOf(did)}</Text>
                {did === conv.admin ? <Text style={[styles.badge, { color: colors.accent, borderColor: colors.accent }]}>{t.friends.adminBadge}</Text> : null}
                {did === myDid ? <Text style={[styles.badge, { color: colors.textMuted, borderColor: colors.border }]}>{t.friends.youBadge}</Text> : null}
                {isAdmin && did !== myDid ? (
                  <Pressable hitSlop={8} onPress={() => removeMembers(gid, [did])}>
                    <Icon name="ban-outline" size={20} color={colors.danger} />
                  </Pressable>
                ) : null}
              </View>
            )}
          />

          {/* Adăugare membri — doar adminul, doar dacă mai e loc și are contacte neincluse */}
          {isAdmin && addable.length > 0 && room > 0 ? (
            adding ? (
              <>
                <Text style={[type.label, { marginTop: space.md, marginBottom: space.sm }]}>{t.friends.selectMembers}</Text>
                <FlatList
                  data={addable}
                  keyExtractor={(c) => c.did}
                  style={{ maxHeight: 180 }}
                  renderItem={({ item }) => {
                    const on = sel.has(item.did);
                    return (
                      <Pressable style={styles.row} onPress={() => toggleSel(item.did)}>
                        <Avatar name={item.name} did={item.did} size={36} />
                        <Text style={[styles.name, { color: colors.textPrimary }]}>{item.name}</Text>
                        <View style={[styles.check, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : "transparent" }]}>
                          {on ? <Text style={{ color: colors.onPrimary, fontSize: 12 }}>✓</Text> : null}
                        </View>
                      </Pressable>
                    );
                  }}
                />
                <Pressable onPress={confirmAdd} disabled={!sel.size} style={[styles.btn, { backgroundColor: colors.primary, opacity: sel.size ? 1 : 0.4 }]}>
                  <Text style={{ color: colors.onPrimary, fontFamily: fonts.bodySemibold, fontSize: 14 }}>{t.friends.addConfirm}</Text>
                </Pressable>
              </>
            ) : (
              <Pressable style={styles.optRow} onPress={() => setAdding(true)}>
                <Icon name="add-circle-outline" size={20} color={colors.accent} />
                <Text style={[type.body, { color: colors.textPrimary }]}>{t.friends.addMembers}</Text>
              </Pressable>
            )
          ) : null}
          {isAdmin && room <= 0 ? (
            <Text style={[type.caption, { marginTop: space.sm }]}>{format(t.friends.groupFull, { n: GROUP_MAX })}</Text>
          ) : null}

          {/* Părăsire — oricine (dacă mai e membru) */}
          {myDid && members.includes(myDid) ? (
            <>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <Pressable style={styles.optRow} onPress={onLeave}>
                <Icon name="arrow-back" size={20} color={colors.danger} />
                <Text style={[type.body, { color: colors.danger }]}>{t.friends.leaveGroup}</Text>
              </Pressable>
            </>
          ) : (
            <Text style={[type.caption, { marginTop: space.md }]}>{t.friends.notMember}</Text>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: radius["2xl"], borderTopRightRadius: radius["2xl"], borderWidth: StyleSheet.hairlineWidth, padding: space.lg },
  grip: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: space.md },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.sm },
  name: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 15 },
  badge: { fontFamily: fonts.mono, fontSize: 10, borderWidth: 1, borderRadius: radius.full, paddingHorizontal: 6, paddingVertical: 1 },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  btn: { height: 44, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  optRow: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: space.md },
  divider: { height: StyleSheet.hairlineWidth, marginTop: space.md, marginBottom: space.xs },
});
