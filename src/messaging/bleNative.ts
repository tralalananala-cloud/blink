/**
 * Binding gardat către modulul nativ BlinkBle (expo-modules, Android-only — vine în lotul BLE-2).
 * Pe web/desktop/iOS sau când modulul lipsește din build → null = transportul BLE e oprit,
 * app-ul merge exact ca înainte (același pattern ca UnavailableEngine pe web).
 */
import { Platform } from "react-native";

export interface BleNative {
  /**
   * Pornește advertiser (service data = did8 propriu) + scanner + serverul GATT, într-un serviciu
   * de foreground care ține mesh-ul viu și cu app-ul închis. title/body = textul notificării
   * permanente cerute de Android (vin din i18n, ca să nu hardcodăm o limbă în nativ).
   */
  start(myDid8: string, title: string, body: string): Promise<void>;
  stop(): Promise<void>;
  /**
   * Mod HOLD (fără BLE): pornește serviciul de foreground doar ca să țină procesul/contextul JS viu
   * pentru polling-ul Reticulum cu app-ul închis. Independent de start/stop prin ref-counting nativ.
   */
  startHold(title: string, body: string): Promise<void>;
  stopHold(): Promise<void>;
  /** Trimite un blob opac peer-ului din apropiere cu did8-ul dat. false = nelivrat. */
  send(did8: string, blobB64: string): Promise<boolean>;
  /**
   * Polling Reticulum NATIV (thread propriu, nu timer JS → rulează și cu app-ul închis, când RN
   * pune pe pauză setInterval). Blob-urile primite sosesc pe evenimentul `onReticulumBlob`.
   * Idempotent: re-apelabil la re-register (actualizează addr/token). Trimiterea rămâne în JS.
   */
  startReticulumPoll(gateway: string, addr: string, token: string): Promise<void>;
  stopReticulumPoll(): Promise<void>;
  addListener(
    event: "onBlob" | "onPeerSeen" | "onPeerLost" | "onReticulumBlob",
    cb: (e: { blobB64?: string; did8?: string; blob?: string }) => void
  ): { remove(): void };
}

export function loadBleNative(): BleNative | null {
  if (Platform.OS !== "android") return null;
  try {
    const { requireNativeModule } = require("expo-modules-core");
    return requireNativeModule("BlinkBle");
  } catch {
    return null; // build fără modulul nativ (ex. Expo Go) → BLE indisponibil, nu crăpăm
  }
}

/**
 * Cere permisiunile Bluetooth runtime (dialog Android). Android 12+: SCAN/ADVERTISE/CONNECT;
 * ≤11: scanarea BLE cerea locație. Refuz → false, transportul rămâne oprit (fallback releu).
 * ⚠️ ColorOS: `pm grant` prin adb NU merge — la test se acceptă manual din dialog/Settings.
 */
export async function ensureBlePermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    const { PermissionsAndroid } = require("react-native");
    const wanted: string[] =
      Number(Platform.Version) >= 31
        ? ["android.permission.BLUETOOTH_SCAN", "android.permission.BLUETOOTH_ADVERTISE", "android.permission.BLUETOOTH_CONNECT"]
        : ["android.permission.ACCESS_FINE_LOCATION"];
    const res = await PermissionsAndroid.requestMultiple(wanted);
    if (!wanted.every((p) => res[p] === "granted")) return false;

    // Android 13+: fără POST_NOTIFICATIONS notificarea serviciului nu se vede. Serviciul PORNEȘTE
    // oricum (sistemul nu-l refuză), deci refuzul aici nu blochează mesh-ul — nu-l returnăm ca eșec.
    if (Number(Platform.Version) >= 33) {
      try {
        await PermissionsAndroid.request("android.permission.POST_NOTIFICATIONS");
      } catch {}
    }
    return true;
  } catch {
    return false;
  }
}
