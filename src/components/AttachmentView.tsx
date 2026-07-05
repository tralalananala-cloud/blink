import React, { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image"; // M3 — downsamplează la dimensiunea de afișare (anti-OOM bitmap)
import { Audio, ResizeMode, Video } from "expo-av";
import { radius, space } from "../theme/tokens";
import { fonts } from "../theme/typography";
import { useTheme } from "../theme/ThemeProvider";
import { Attachment } from "../data/mockData";
import { setPlaybackAudioMode } from "../media/audioMode";

function fmtDur(ms?: number): string {
  const s = Math.round((ms ?? 0) / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}
function fmtSize(b?: number): string {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

const BUBBLE_W = 240;

export function AttachmentView({ att, mine }: { att: Attachment; mine: boolean }) {
  const { colors } = useTheme();
  const fg = mine ? colors.bubbleMineText : colors.bubbleTheirsText;

  if (att.kind === "image") {
    const ratio = att.width && att.height ? att.height / att.width : 1.2;
    return (
      <Image
        source={{ uri: att.uri }}
        style={{ width: BUBBLE_W, height: Math.min(BUBBLE_W * ratio, 320), borderRadius: radius.md, backgroundColor: colors.surfaceAlt }}
        contentFit="cover"
        recyclingKey={att.uri}
        cachePolicy="memory-disk"
        transition={120}
      />
    );
  }

  if (att.kind === "video") return <VideoAttachment uri={att.uri} />;

  if (att.kind === "circle") return <CirclePlayer att={att} />;
  if (att.kind === "voice") return <VoicePlayer att={att} mine={mine} />;

  // file
  return (
    <View style={[styles.file, { borderColor: mine ? colors.bubbleMineText + "55" : colors.border }]}>
      <View style={[styles.fileIcon, { backgroundColor: colors.accent }]}>
        <Text style={{ color: colors.onPrimary, fontFamily: fonts.bodySemibold, fontSize: 11 }}>
          {(att.name?.split(".").pop() ?? "FILE").slice(0, 4).toUpperCase()}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: fg, fontFamily: fonts.bodyMedium, fontSize: 13 }}>
          {att.name ?? "fișier"}
        </Text>
        <Text style={{ color: fg, opacity: 0.6, fontFamily: fonts.mono, fontSize: 11 }}>{fmtSize(att.size)}</Text>
      </View>
    </View>
  );
}

function VideoAttachment({ uri }: { uri: string }) {
  const { colors } = useTheme();
  // asigură sunet la redare (mod playback, nu silent/earpiece)
  useEffect(() => { setPlaybackAudioMode(); }, []);
  return (
    <Video
      source={{ uri }}
      style={{ width: BUBBLE_W, height: BUBBLE_W * 1.1, borderRadius: radius.md, backgroundColor: "#000" }}
      useNativeControls
      resizeMode={ResizeMode.COVER}
      volume={1.0}
      isMuted={false}
    />
  );
}

function VoicePlayer({ att, mine }: { att: Attachment; mine: boolean }) {
  const { colors } = useTheme();
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false); // cât se face createAsync (poate dura pe fișier proaspăt)
  const [error, setError] = useState(false);     // redarea a eșuat → feedback vizibil, nu buton mort
  const soundRef = useRef<Audio.Sound | null>(null);
  const fg = mine ? colors.bubbleMineText : colors.bubbleTheirsText;

  // waveform pseudo-random stabil din uri
  let h = 0;
  for (const c of att.uri) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const bars = Array.from({ length: 28 }, (_, i) => {
    h = (h * 1103515245 + 12345) & 0x7fffffff;
    return 6 + ((h >> 8) % 18);
  });

  useEffect(() => () => { soundRef.current?.unloadAsync(); soundRef.current = null; }, []);

  async function toggle() {
    if (loading) return; // V: guard anti-dublu-tap — nu porni o a doua redare cât se încarcă
    setError(false);
    try {
      await setPlaybackAudioMode(); // sunet garantat (silent mode / post-recording)
      if (!soundRef.current) {
        setLoading(true);
        const { sound } = await Audio.Sound.createAsync(
          { uri: att.uri },
          { volume: 1.0, isLooping: false, shouldPlay: false },
        );
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((st: any) => {
          if (!st.isLoaded) {
            // eroare de descărcare/decodare raportată de expo-av → NU o înghiți
            if (st.error) { console.warn("[Blink] voice playback error:", st.error); setError(true); setPlaying(false); }
            return;
          }
          // V: o singură dată + stop la final. isLooping:false + la didJustFinish oprim EXPLICIT
          // (pauseAsync, nu doar reset) și readucem poziția la 0 → butonul revine curat la ▶ și
          // următorul tap pornește o singură redare de la început.
          if (st.didJustFinish) {
            setPlaying(false);
            soundRef.current?.pauseAsync().catch(() => {});
            soundRef.current?.setPositionAsync(0).catch(() => {});
          }
        });
        setLoading(false);
      }
      if (playing) { await soundRef.current.pauseAsync(); setPlaying(false); }
      else { await soundRef.current.playAsync(); setPlaying(true); }
    } catch (e) {
      // V: tratare reală (nu `catch { /* demo */ }`) — log + stare de eroare vizibilă în UI
      console.warn("[Blink] voice message failed:", e);
      setError(true); setLoading(false); setPlaying(false);
    }
  }

  const glyph = loading ? "…" : error ? "!" : playing ? "⏸" : "▶";
  return (
    <View style={styles.voice}>
      <Pressable
        onPress={toggle}
        accessibilityLabel={error ? "Redare vocală eșuată, reîncearcă" : playing ? "Pauză" : "Redă mesajul vocal"}
        style={[styles.playBtn, { backgroundColor: error ? colors.danger : mine ? colors.bubbleMineText : colors.primary }]}
      >
        <Text style={{ color: error ? colors.onPrimary : mine ? colors.bubbleMine : colors.onPrimary, fontSize: 14 }}>{glyph}</Text>
      </Pressable>
      <View style={styles.wave}>
        {bars.map((bh, i) => (
          <View key={i} style={{ width: 2.5, height: bh, borderRadius: 2, backgroundColor: fg, opacity: 0.55 }} />
        ))}
      </View>
      <Text style={{ color: fg, opacity: 0.7, fontFamily: fonts.mono, fontSize: 11 }}>{fmtDur(att.durationMs)}</Text>
    </View>
  );
}

function CirclePlayer({ att }: { att: Attachment }) {
  const ref = useRef<Video>(null);
  const [playing, setPlaying] = useState(false);
  const D = 180;
  return (
    <Pressable
      onPress={async () => {
        try {
          await setPlaybackAudioMode();
          if (playing) { await ref.current?.pauseAsync(); setPlaying(false); }
          else { await ref.current?.playFromPositionAsync(0); setPlaying(true); }
        } catch {}
      }}
    >
      <Video
        ref={ref}
        source={{ uri: att.uri }}
        style={{ width: D, height: D, borderRadius: D / 2, backgroundColor: "#000" }}
        resizeMode={ResizeMode.COVER}
        volume={1.0}
        isMuted={false}
        onPlaybackStatusUpdate={(st: any) => { if (st.didJustFinish) setPlaying(false); }}
      />
      {!playing ? (
        <View style={[StyleSheet.absoluteFill, styles.circleOverlay]}>
          <Text style={{ color: "#fff", fontSize: 30 }}>▶</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  file: { flexDirection: "row", alignItems: "center", gap: space.sm, width: BUBBLE_W, borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md, padding: space.sm },
  fileIcon: { width: 38, height: 38, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  voice: { flexDirection: "row", alignItems: "center", gap: space.sm, width: BUBBLE_W },
  playBtn: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  wave: { flex: 1, flexDirection: "row", alignItems: "center", gap: 2, height: 28 },
  circleOverlay: { alignItems: "center", justifyContent: "center", borderRadius: 90, backgroundColor: "rgba(0,0,0,0.25)" },
});
