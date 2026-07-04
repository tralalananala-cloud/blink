/** Acțiuni media: pick poză/video/fișier + înregistrare voce (expo-av). */
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { Audio } from "expo-av";
import { Attachment } from "../data/mockData";
import { setPlaybackAudioMode, setRecordingAudioMode } from "./audioMode";

// T2 — latura mare a pozei, plafonată. 1600px = clar pe orice ecran, dar ~200KB în loc de MB.
const MAX_IMAGE_DIM = 1600;

/**
 * Trece poza prin expo-image-manipulator: reduce latura mare la MAX_IMAGE_DIM și
 * RE-ENCODEAZĂ JPEG (quality 0.7). Re-encodarea aruncă TOT EXIF-ul, deci și GPS-ul →
 * fără scurgere de locație către destinatar. Chiar dacă poza e deja mică, o re-encodăm
 * (actions gol) tocmai ca să cadă EXIF-ul. La orice eșec, cădem pe originalul dat.
 */
async function processImage(uri: string, width?: number, height?: number): Promise<{ uri: string; width?: number; height?: number }> {
  try {
    const actions: ImageManipulator.Action[] = [];
    const long = Math.max(width ?? 0, height ?? 0);
    if (long > MAX_IMAGE_DIM) {
      // scalăm doar latura dominantă → proporția e păstrată automat
      actions.push((width ?? 0) >= (height ?? 0) ? { resize: { width: MAX_IMAGE_DIM } } : { resize: { height: MAX_IMAGE_DIM } });
    }
    const res = await ImageManipulator.manipulateAsync(uri, actions, {
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    return { uri: res.uri, width: res.width, height: res.height };
  } catch {
    return { uri, width, height }; // degradare grațioasă — mai bine trimite decât să pice
  }
}

export async function pickImage(): Promise<Attachment | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.7,
  });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  const p = await processImage(a.uri, a.width, a.height);
  return { kind: "image", uri: p.uri, width: p.width, height: p.height };
}

export async function pickVideo(): Promise<Attachment | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Videos,
    quality: 0.7,
  });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return { kind: "video", uri: a.uri, width: a.width, height: a.height, size: a.fileSize, durationMs: a.duration ?? undefined };
}

export async function takePhoto(): Promise<Attachment | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return null;
  const res = await ImagePicker.launchCameraAsync({ quality: 0.7 });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  const p = await processImage(a.uri, a.width, a.height); // T2: resize + strip EXIF/GPS
  return { kind: "image", uri: p.uri, width: p.width, height: p.height };
}

export async function pickFile(): Promise<Attachment | null> {
  const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  return { kind: "file", uri: a.uri, name: a.name, size: a.size ?? undefined };
}

/** Recorder de voce — un singur obiect activ. */
export class VoiceRecorder {
  private rec: Audio.Recording | null = null;
  private startedAt = 0;

  async start(): Promise<boolean> {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return false;
      await setRecordingAudioMode();
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      this.rec = recording;
      this.startedAt = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  async stop(): Promise<Attachment | null> {
    if (!this.rec) return null;
    try {
      await this.rec.stopAndUnloadAsync();
      const uri = this.rec.getURI();
      const dur = Date.now() - this.startedAt;
      this.rec = null;
      await setPlaybackAudioMode(); // restabilește redarea cu sunet
      if (!uri) return null;
      return { kind: "voice", uri, durationMs: dur };
    } catch {
      this.rec = null;
      return null;
    }
  }

  async cancel(): Promise<void> {
    try {
      await this.rec?.stopAndUnloadAsync();
    } catch {}
    this.rec = null;
  }
}
