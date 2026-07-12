/**
 * Mod audio pentru REDARE (voce, video, cerculețe).
 * Important: fără asta, pe iOS în mod silențios sunetul e mut, iar după o
 * înregistrare modul rămâne „recording" și poate ruta/muta redarea.
 */
import { Platform } from "react-native";
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from "expo-av";

/**
 * BLE-4 a rupt redarea vocii, și merită explicat: cu serviciul de foreground, procesul nu mai
 * moare niciodată. expo-av își ține propriul flag „sunt în fundal" din ciclul de viață RN, iar
 * cu `staysActiveInBackground: false` REFUZĂ focusul audio când crede că e în fundal —
 * `AudioFocusNotAcquiredException`. Înainte, procesul renăștea curat la fiecare deschidere și
 * flagul era mereu corect; acum poate rămâne blocat pe „background" deși userul are app-ul deschis.
 *
 * Pe Android îl lăsăm activ: avem oricum un serviciu de foreground, iar o notă vocală care nu se
 * oprește când schimbi aplicația e comportamentul așteptat. Pe iOS ar cere `UIBackgroundModes:
 * audio` în config — fără el, expo-av poate arunca — deci acolo rămâne pe false.
 */
const STAYS_ACTIVE_BG = Platform.OS === "android";

export async function setPlaybackAudioMode(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true, // redă chiar dacă telefonul e pe silent
      staysActiveInBackground: STAYS_ACTIVE_BG,
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
