/**
 * Verificarea contactului (anti-MITM / anti-impersonare).
 *
 * Afișează safety number-ul = fingerprint comun al celor două identități. E SIMETRIC
 * (engine sortează cheile) → ambele telefoane arată ACELAȘI cod. Verificare:
 *  - manual: compari cifrele cu prietenul (telefon / alt canal de încredere), SAU
 *  - scan: scanezi QR-ul prietenului; dacă valoarea == codul tău → match → marcat verificat.
 * Dacă diferă → cineva e la mijloc (MITM) sau una din identități s-a schimbat.
 */
import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import QRCode from "react-native-qrcode-svg";
import { useTheme } from "../theme/ThemeProvider";
import { fonts } from "../theme/typography";
import { radius, space } from "../theme/tokens";
import { useI18n } from "../i18n";
import { engine } from "../crypto";
import { useApp } from "../state/store";
import { Icon } from "./Icon";

export function VerifySafetyModal({
  visible, convId, peerDid, peerName, onClose,
}: { visible: boolean; convId: string; peerDid: string; peerName: string; onClose: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const markVerified = useApp((s) => s.markVerified);
  const [code, setCode] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<"match" | "nomatch" | null>(null);
  const [perm, requestPerm] = useCameraPermissions();

  useEffect(() => {
    if (!visible) { setScanning(false); setResult(null); return; }
    engine.computeSafetyNumber(peerDid).then((c) => setCode(c || null));
  }, [visible, peerDid]);

  function onScan(data: string) {
    setScanning(false);
    const got = data.trim().replace(/\s+/g, " ");
    const mine = (code || "").trim();
    if (got && mine && got === mine) {
      setResult("match");
      markVerified(convId);
    } else {
      setResult("nomatch");
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.bgRaised, borderColor: colors.border }]}>
          <View style={styles.head}>
            <Icon name="shield" size={20} color={colors.primary} />
            <Text style={[styles.title, { color: colors.textPrimary }]}>{t.verify.title} {peerName}</Text>
          </View>

          {code === null ? (
            <Text style={[styles.body, { color: colors.textSecondary }]}>{t.verify.noSession}</Text>
          ) : scanning ? (
            !perm?.granted ? (
              <Pressable onPress={requestPerm} style={[styles.btn, { backgroundColor: colors.primary }]}>
                <Text style={[styles.btnText, { color: colors.onPrimary }]}>{t.verify.allowCamera}</Text>
              </Pressable>
            ) : (
              <View style={styles.cam}>
                <CameraView
                  style={{ flex: 1 }}
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={({ data }) => onScan(data)}
                />
              </View>
            )
          ) : (
            <>
              <Text style={[styles.body, { color: colors.textSecondary }]}>{t.verify.body}</Text>
              <View style={styles.qrWrap}>
                <QRCode value={code} size={170} color="#0A0C10" backgroundColor="#FFFFFF" ecl="M" />
              </View>
              <Text style={[styles.digits, { color: colors.textPrimary }]}>{code}</Text>

              {result === "match" ? (
                <Text style={[styles.resultOk, { color: colors.secure }]}>✓ {t.verify.match}</Text>
              ) : result === "nomatch" ? (
                <Text style={[styles.resultBad, { color: colors.warning }]}>⚠ {t.verify.noMatch}</Text>
              ) : null}

              <View style={styles.row}>
                <Pressable onPress={() => { setResult(null); setScanning(true); }} style={[styles.btn, styles.flex, { backgroundColor: colors.primary }]}>
                  <Text style={[styles.btnText, { color: colors.onPrimary }]}>{t.verify.scan}</Text>
                </Pressable>
                <Pressable onPress={() => { markVerified(convId); onClose(); }} style={[styles.btn, styles.flex, { borderColor: colors.secure, borderWidth: StyleSheet.hairlineWidth }]}>
                  <Text style={[styles.btnText, { color: colors.secure }]}>{t.verify.mark}</Text>
                </Pressable>
              </View>
            </>
          )}

          <Pressable onPress={onClose} style={styles.close}>
            <Text style={{ color: colors.textSecondary, fontFamily: fonts.body }}>{t.common.close ?? "Close"}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { borderTopLeftRadius: radius["2xl"], borderTopRightRadius: radius["2xl"], borderWidth: StyleSheet.hairlineWidth, padding: space.lg, gap: space.md },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  title: { fontFamily: fonts.bodySemibold, fontSize: 16, flex: 1 },
  body: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19 },
  qrWrap: { alignSelf: "center", padding: space.sm, backgroundColor: "#FFFFFF", borderRadius: radius.md },
  digits: { fontFamily: fonts.mono, fontSize: 16, letterSpacing: 1, textAlign: "center", lineHeight: 26 },
  resultOk: { fontFamily: fonts.bodySemibold, fontSize: 15, textAlign: "center" },
  resultBad: { fontFamily: fonts.bodySemibold, fontSize: 14, textAlign: "center" },
  row: { flexDirection: "row", gap: space.sm },
  flex: { flex: 1 },
  btn: { paddingVertical: space.md, borderRadius: radius.lg, alignItems: "center" },
  btnText: { fontFamily: fonts.bodySemibold, fontSize: 15 },
  cam: { height: 260, borderRadius: radius.lg, overflow: "hidden" },
  close: { alignItems: "center", paddingVertical: space.sm },
});
