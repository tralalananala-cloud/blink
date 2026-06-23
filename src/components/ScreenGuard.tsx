import { useEffect } from "react";
import * as ScreenCapture from "expo-screen-capture";
import { useApp } from "../state/store";

/**
 * Blochează capturile de ecran și înregistrarea ecranului cât timp setarea
 * „Screenshot blocker" e activă (implicit ON). Pe Android = FLAG_SECURE:
 * capturile ies negre, iar miniatura din app-switcher e ascunsă.
 */
export function ScreenGuard() {
  const blocker = useApp((s) => s.settings.screenshotBlocker);
  useEffect(() => {
    (blocker ? ScreenCapture.preventScreenCaptureAsync() : ScreenCapture.allowScreenCaptureAsync()).catch(() => {});
  }, [blocker]);
  return null;
}
