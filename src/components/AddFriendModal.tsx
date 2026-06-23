import React, { useState } from "react";
import { Modal, Pressable, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import QRCode from "react-native-qrcode-svg";
import * as Haptics from "expo-haptics";
import { Icon } from "./Icon";
import { radius, space } from "../theme/tokens";
import { fonts } from "../theme/typography";
import { useTheme, useType } from "../theme/ThemeProvider";
import { useI18n } from "../i18n";
import { useApp } from "../state/store";
import { isValidDid } from "../data/mockData";
import { engine } from "../crypto";

export function AddFriendModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const type = useType();
  const { t } = useI18n();
  const addContact = useApp((s) => s.addContact);
  const clearNeedsRepair = useApp((s) => s.clearNeedsRepair);
  const identity = useApp((s) => s.identity);
  const profileName = useApp((s) => s.settings.profileName);
  // codul meu = DID + numele meu (ca celălalt să vadă numele când mă scanează)
  const myPayload = identity ? JSON.stringify({ did: identity.did, n: profileName || "" }) : "";
  const [tab, setTab] = useState<"add" | "mine">("add");
  const [did, setDid] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [perm, requestPerm] = useCameraPermissions();

  function reset() {
    setDid(""); setName(""); setErr(null); setScanning(false); setTab("add");
  }
  function close() { reset(); onClose(); }

  function shareMine() {
    if (!identity) return;
    Share.share({ message: identity.did }).catch(() => {});
  }

  function submit() {
    const d = did.trim();
    if (!isValidDid(d)) { setErr(t.friends.invalidDid); return; }
    const ok = addContact(name, d);
    if (!ok) {
      // contact deja existent → RE-PAIRING (după ce unul și-a resetat/restaurat identitatea):
      // resetează sesiunea veche spartă → următorul mesaj re-stabilește X3DH (prekey nou).
      engine.resetSession?.(d);
      clearNeedsRepair(d);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      close();
      return;
    }
    // sesiunea X3DH se stabilește la primul mesaj (prin releu).
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    close();
  }

  async function openScanner() {
    if (!perm?.granted) {
      const r = await requestPerm();
      if (!r.granted) return;
    }
    setScanning(true);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={[styles.sheet, { backgroundColor: colors.bgRaised, borderColor: colors.border }]} onPress={() => {}}>
          <View style={[styles.grip, { backgroundColor: colors.border }]} />

          {/* tab-uri: Adaugă / Codul meu */}
          <View style={[styles.tabs, { backgroundColor: colors.surface }]}>
            {(["add", "mine"] as const).map((k) => (
              <Text
                key={k}
                onPress={() => { setScanning(false); setTab(k); }}
                style={[styles.tab, { color: tab === k ? colors.primary : colors.textSecondary }, tab === k && { backgroundColor: colors.bgRaised, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.primary }]}
              >
                {k === "add" ? t.friends.tabAdd : t.friends.tabMine}
              </Text>
            ))}
          </View>

          {tab === "mine" ? (
            <View style={{ alignItems: "center", paddingTop: space.md }}>
              <Text style={type.h3}>{t.friends.myCodeTitle}</Text>
              <Text style={[type.caption, { marginTop: 4, marginBottom: space.lg, textAlign: "center" }]}>{t.friends.myCodeHint}</Text>
              <View style={styles.qrCard}>
                {identity ? <QRCode value={myPayload} size={196} color="#0A0C10" backgroundColor="#FFFFFF" ecl="M" /> : null}
              </View>
              <Text style={[styles.didText, { color: colors.textSecondary }]} numberOfLines={2}>{identity?.did}</Text>
              <Pressable onPress={shareMine} style={[styles.addBtn, { backgroundColor: colors.primary, width: "100%", flexDirection: "row", gap: 8 }]}>
                <Icon name="share-outline" size={18} color={colors.onPrimary} />
                <Text style={{ color: colors.onPrimary, fontFamily: fonts.bodySemibold, fontSize: 15 }}>{t.friends.share}</Text>
              </Pressable>
            </View>
          ) : scanning ? (
            <View style={styles.scanBox}>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                onBarcodeScanned={({ data }) => {
                  setScanning(false);
                  let sd = "", sn = "";
                  try { const o = JSON.parse(data); if (o && o.did) { sd = o.did; sn = o.n || ""; } } catch {}
                  if (!sd) { const m = data.match(/did:key:z[A-Za-z0-9]+/); sd = m ? m[0] : data.trim(); }
                  setDid(sd);
                  if (sn) setName(sn); // numele contactului din QR
                  setErr(null);
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                }}
              />
              <View style={[styles.scanFrame, { borderColor: colors.primary }]} />
              <Text style={styles.scanHint}>{t.friends.scanHint}</Text>
            </View>
          ) : (
            <>
              <TextInput
                value={did}
                onChangeText={(v) => { setDid(v); setErr(null); }}
                placeholder={t.friends.didPlaceholder}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: err ? colors.danger : colors.border, color: colors.textPrimary }]}
              />
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={t.friends.namePlaceholder}
                placeholderTextColor={colors.textMuted}
                style={[styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.textPrimary, marginTop: space.sm }]}
              />
              {err ? <Text style={[styles.err, { color: colors.danger }]}>{err}</Text> : null}

              <Pressable onPress={openScanner} style={[styles.scanBtn, { borderColor: colors.accent, flexDirection: "row", gap: 8 }]}>
                <Icon name="scan-outline" size={18} color={colors.accent} />
                <Text style={{ color: colors.accent, fontFamily: fonts.bodySemibold }}>{t.friends.scan}</Text>
              </Pressable>

              <Pressable onPress={submit} style={[styles.addBtn, { backgroundColor: colors.primary }]}>
                <Text style={{ color: colors.onPrimary, fontFamily: fonts.bodySemibold, fontSize: 15 }}>{t.friends.addBtn}</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: radius["2xl"], borderTopRightRadius: radius["2xl"], borderWidth: StyleSheet.hairlineWidth, padding: space.lg, paddingBottom: space.xxxl },
  grip: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginBottom: space.md },
  tabs: { flexDirection: "row", gap: space.sm, borderRadius: radius.lg, padding: 4, marginBottom: space.md },
  tab: { flex: 1, textAlign: "center", paddingVertical: space.sm, borderRadius: radius.md, fontFamily: fonts.bodyMedium, fontSize: 14, overflow: "hidden" },
  qrCard: { padding: space.md, borderRadius: radius.lg, backgroundColor: "#FFFFFF" },
  didText: { fontFamily: fonts.mono, fontSize: 12, textAlign: "center", marginVertical: space.md, paddingHorizontal: space.md },
  input: { height: 50, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space.md, fontFamily: fonts.mono, fontSize: 13 },
  err: { fontFamily: fonts.bodyMedium, fontSize: 12, marginTop: space.sm },
  scanBtn: { height: 48, borderRadius: radius.lg, borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: space.md },
  addBtn: { height: 52, borderRadius: radius.xl, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  scanBox: { height: 280, borderRadius: radius.lg, overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
  scanFrame: { width: 180, height: 180, borderWidth: 2, borderRadius: radius.lg },
  scanHint: { position: "absolute", bottom: 16, color: "#fff", fontFamily: fonts.body, fontSize: 13 },
});
