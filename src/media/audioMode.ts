/**
 * Mod audio pentru REDARE (voce, video, cerculețe).
 * Important: fără asta, pe iOS în mod silențios sunetul e mut, iar după o
 * înregistrare modul rămâne „recording" și poate ruta/muta redarea.
 */
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";

export async function setPlaybackAudioMode(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true, // redă chiar dacă telefonul e pe silent
      staysActiveInBackground: false,
      interruptionModeIOS: InterruptionModeIOS.DoNotMix,
      interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false, // prin difuzor, nu cască
    });
  } catch {
    /* unele platforme nu acceptă toate opțiunile */
  }
}

export async function setRecordingAudioMode(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  } catch {
    /* noop */
  }
}
