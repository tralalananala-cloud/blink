/**
 * T5 — livrarea notificărilor cu app-ul ÎNCHIS pe Android OEM (ColorOS/OPPO, MIUI, etc.).
 *
 * Nu e un bug de cod: FCM cu `priority:"high"` există deja. Producătorii ca OPPO omoară procesul
 * și taie push-ul dacă app-ul nu e pus pe „autostart" + „fără restricții de baterie". La fel fac
 * Signal/WhatsApp — livrarea garantată în fundal NU există fără whitelist-ul userului. De aceea
 * doar GHIDĂM userul o dată spre setările sistemului; nu putem forța, și nici măcar citi cu
 * certitudine starea pe toate OEM-urile (de-aici „best-effort").
 */
import { Platform } from "react-native";
import * as IntentLauncher from "expo-intent-launcher";

const APP_PACKAGE = "io.blink.app";

/** Doar Android are conceptul de whitelist baterie/autostart; pe iOS pasul nu are sens. */
export const supportsBackgroundHint = Platform.OS === "android";

/**
 * Deschide ecranul de optimizare a bateriei. Best-effort: pe unele OEM ajunge la lista generală
 * (nu la comutatorul direct al app-ului), de-aceea căderea pe „detaliile aplicației". Întoarce
 * `true` dacă a reușit să deschidă VREUN ecran relevant, `false` altfel (ex. iOS).
 */
export async function openBatteryOptimizationSettings(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
    return true;
  } catch {
    // fallback universal: pagina de detalii a aplicației (de unde userul intră la Baterie/Autostart)
    try {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS, {
        data: "package:" + APP_PACKAGE,
      });
      return true;
    } catch {
      return false;
    }
  }
}
