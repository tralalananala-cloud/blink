import React, { useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import { fonts } from "../theme/typography";
import { useTheme } from "../theme/ThemeProvider";

/** Înregistrează un „cerculeț" video rotund (stil Telegram). */
export function CircleRecorder({
  visible,
  onClose,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  onDone: (uri: string, durationMs: number) => void;
}) {
  const { colors } = useTheme();
  const [camPerm, reqCam] = useCameraPermissions();
  const [micPerm, reqMic] = useMicrophonePermissions();
  const camRef = useRef<CameraView>(null);
  const [recording, setRecording] = useState(false);
  const startedRef = useRef(0);

  const ready = camPerm?.granted && micPerm?.granted;
  const D = 300;

  async function start() {
    if (!camRef.current || recording) return;
    setRecording(true);
    startedRef.current = Date.now();
    try {
      // maxFileSize 7MB: oprește filmarea înainte să depășească plafonul de transfer (8MB)
      // → cerculețul se trimite mereu, fără OutOfMemory pe telefon.
      const v = await camRef.current.recordAsync({ maxDuration: 15, maxFileSize: 7 * 1024 * 1024 });
      const dur = Date.now() - startedRef.current;
      if (v?.uri) onDone(v.uri, dur);
    } catch {
      /* demo */
    } finally {
      setRecording(false);
    }
  }
  function stop() {
    camRef.current?.stopRecording();
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        {!ready ? (
          <View style={styles.permBox}>
            <Text style={[styles.permText, { color: "#fff" }]}>
              Blink are nevoie de cameră și microfon pentru cerculețe.
            </Text>
            <Pressable
              style={[styles.permBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                reqCam();
                reqMic();
              }}
            >
              <Text style={{ color: colors.onPrimary, fontFamily: fonts.bodySemibold }}>Permite</Text>
            </Pressable>
            <Pressable onPress={onClose} style={{ marginTop: 14 }}>
              <Text style={{ color: "#fff", opacity: 0.7 }}>Anulează</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={{ width: D, height: D, borderRadius: D / 2, overflow: "hidden", borderWidth: 3, borderColor: recording ? colors.danger : colors.primary }}>
              <CameraView ref={camRef} style={{ flex: 1 }} facing="front" mode="video" />
            </View>
            <Text style={styles.hint}>{recording ? "● Înregistrează… apasă pentru stop" : "Apasă cercul ca să înregistrezi (max 15s)"}</Text>
            <Pressable
              onPress={recording ? stop : start}
              style={[styles.recBtn, { borderColor: colors.primary, backgroundColor: recording ? colors.danger : "transparent" }]}
            >
              <View style={[styles.recDot, { backgroundColor: recording ? "#fff" : colors.danger, borderRadius: recording ? 6 : 16 }]} />
            </Pressable>
            <Pressable onPress={onClose} style={{ marginTop: 18 }}>
              <Text style={{ color: "#fff", opacity: 0.7 }}>Închide</Text>
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center" },
  hint: { color: "#fff", opacity: 0.8, marginTop: 22, fontFamily: fonts.body, fontSize: 13 },
  recBtn: { width: 72, height: 72, borderRadius: 36, borderWidth: 4, alignItems: "center", justifyContent: "center", marginTop: 18 },
  recDot: { width: 32, height: 32 },
  permBox: { alignItems: "center", paddingHorizontal: 40 },
  permText: { textAlign: "center", fontFamily: fonts.body, fontSize: 15, marginBottom: 18, lineHeight: 22 },
  permBtn: { paddingHorizontal: 28, paddingVertical: 12, borderRadius: 14 },
});
