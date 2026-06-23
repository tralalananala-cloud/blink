/**
 * Overlay global de apel (Faza 5). Se afișează când callManager are un apel activ/primit.
 * Montat o singură dată în _layout. Folosește RTCView (react-native-webrtc, nativ).
 */
import React, { useEffect, useReducer } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { callManager } from "../calls/webrtc";

// RTCView = modul nativ → încarcă-l doar pe nativ (pe web nu există + nu apar apeluri).
const RTCView: any = Platform.OS === "web" ? null : require("react-native-webrtc").RTCView;
import { useTheme } from "../theme/ThemeProvider";
import { fonts } from "../theme/typography";
import { space, radius } from "../theme/tokens";

export function CallOverlay() {
  const { colors } = useTheme();
  const [, force] = useReducer((x) => x + 1, 0);
  useEffect(() => callManager.subscribe(force), []);

  if (callManager.state === "idle") return null;
  const { state, video, incoming, peerDid, localStream, remoteStream } = callManager;
  const name = (peerDid || "").slice(0, 18) + "…";
  const label =
    state === "calling" ? "Apelare…" :
    state === "ringing" ? (incoming ? "Apel primit" : "Sună…") :
    state === "connected" ? "Conectat" : "Încheiat";

  return (
    <View style={[styles.root, { backgroundColor: "#000" }]}>
      {video && remoteStream ? (
        <RTCView streamURL={(remoteStream as any).toURL()} style={StyleSheet.absoluteFill} objectFit="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <View style={[styles.avatar, { backgroundColor: colors.bgRaised, borderColor: colors.primary }]}>
            <Text style={{ fontSize: 40 }}>{video ? "🎥" : "📞"}</Text>
          </View>
        </View>
      )}
      {video && localStream ? (
        <RTCView streamURL={(localStream as any).toURL()} style={styles.localPip} objectFit="cover" zOrder={1} />
      ) : null}

      <View style={styles.top}>
        <Text style={[styles.name, { color: "#fff" }]} numberOfLines={1}>{name}</Text>
        <Text style={[styles.state, { color: colors.primary }]}>{label}</Text>
      </View>

      <View style={styles.controls}>
        {incoming && state === "ringing" ? (
          <Pressable style={[styles.btn, { backgroundColor: colors.secure }]} onPress={() => callManager.accept()}>
            <Text style={styles.btnGlyph}>✓</Text>
          </Pressable>
        ) : null}
        <Pressable style={[styles.btn, { backgroundColor: colors.danger }]} onPress={() => callManager.hangup()}>
          <Text style={styles.btnGlyph}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, zIndex: 999 },
  center: { alignItems: "center", justifyContent: "center" },
  avatar: { width: 96, height: 96, borderRadius: 48, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  localPip: { position: "absolute", top: 60, right: 16, width: 96, height: 140, borderRadius: radius.md, backgroundColor: "#111" },
  top: { position: "absolute", top: 80, left: 0, right: 0, alignItems: "center", gap: 6 },
  name: { fontFamily: fonts.bodySemibold, fontSize: 20 },
  state: { fontFamily: fonts.bodyMedium, fontSize: 14 },
  controls: { position: "absolute", bottom: 64, left: 0, right: 0, flexDirection: "row", justifyContent: "center", gap: space.xl },
  btn: { width: 68, height: 68, borderRadius: 34, alignItems: "center", justifyContent: "center" },
  btnGlyph: { color: "#fff", fontSize: 28, fontFamily: fonts.bodySemibold },
});
