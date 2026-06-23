import { Alert, Platform } from "react-native";

/**
 * Confirmare distructivă cross-platform.
 * `Alert.alert` din react-native NU funcționează pe web/Electron (e no-op) → de aceea
 * ștergerea nu mergea pe laptop. Pe web folosim window.confirm, pe telefon Alert nativ.
 */
export function confirmDestructive(
  title: string,
  message: string,
  confirmLabel: string,
  onConfirm: () => void,
  cancelLabel = "Anulează",
) {
  if (Platform.OS === "web") {
    const ok = typeof window !== "undefined" && window.confirm(message ? `${title}\n\n${message}` : title);
    if (ok) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: onConfirm },
  ]);
}
