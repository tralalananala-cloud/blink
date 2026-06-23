/** Notificări — locale (app deschis) + push FCM (app închis, Faza 4). Se pot opri din Settings. */
import { AppState, Platform } from "react-native";
import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let granted = false;
let appStateHooked = false;

export async function setupNotifications(): Promise<boolean> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "Mesaje",
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 200, 100, 200],
      });
    }
    let status = (await Notifications.getPermissionsAsync()).status;
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    granted = status === "granted";
  } catch {
    granted = false;
  }
  // B1 — la revenirea în prim-plan, șterge notificările FCM generice (fără convId);
  // ești deja în app și le vezi direct. Cele per-conversație se șterg la deschiderea chatului.
  if (!appStateHooked) {
    appStateHooked = true;
    AppState.addEventListener("change", (s) => {
      // la revenirea în app: șterge TOATE notificările din bară (userul e înapoi → le vede direct)
      if (s === "active") { Notifications.dismissAllNotificationsAsync().catch(() => {}); }
    });
  }
  return granted;
}

/**
 * Token-ul de push al dispozitivului (FCM pe Android). Necesită google-services.json
 * în build. Dacă FCM nu e configurat → întoarce null și app-ul merge normal (fără push).
 */
export async function getPushToken(): Promise<string | null> {
  try {
    if (!granted && !(await setupNotifications())) return null;
    const t = await Notifications.getDevicePushTokenAsync();
    return typeof (t as any)?.data === "string" ? (t as any).data : null;
  } catch {
    return null;
  }
}

export async function notifyMessage(title: string, body: string, convId?: string): Promise<void> {
  if (!granted) return;
  try {
    await Notifications.scheduleNotificationAsync({
      // convId în data → ne lasă să ștergem notificările acestei conversații la citire (B1)
      content: { title, body: body || "New message", data: convId ? { convId } : {} },
      trigger: null, // imediat
    });
  } catch {
    /* noop */
  }
}

/**
 * B1 — la deschiderea/citirea unei conversații, șterge notificările ei din bară
 * (altfel rămâneau agățate după citire). Per-conversație după data.convId;
 * dacă nu putem citi notificările prezente, cădem pe ștergerea tuturor.
 */
export async function dismissConversation(convId: string): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    const mine = presented.filter((n) => (n.request.content.data as any)?.convId === convId);
    // dacă nu găsim potrivire per-conversație (ex. notificare FCM fără convId, sau
    // getPresented nu e suportat pe ColorOS) → ștergem TOT (userul citește = curăță bara).
    if (mine.length === 0) { await Notifications.dismissAllNotificationsAsync(); return; }
    await Promise.all(mine.map((n) => Notifications.dismissNotificationAsync(n.request.identifier)));
  } catch {
    try { await Notifications.dismissAllNotificationsAsync(); } catch { /* noop */ }
  }
}

/** B1 — șterge notificările generice (FCM, fără convId) la revenirea în app. */
export async function dismissGeneric(): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    const generic = presented.filter((n) => !(n.request.content.data as any)?.convId);
    await Promise.all(generic.map((n) => Notifications.dismissNotificationAsync(n.request.identifier)));
  } catch {
    /* noop */
  }
}
