import React, { useEffect, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useFonts as useSpace, SpaceGrotesk_600SemiBold, SpaceGrotesk_700Bold } from "@expo-google-fonts/space-grotesk";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import { View } from "react-native";
import { I18nProvider } from "../src/i18n";
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider";
import { AppLockGate } from "../src/components/AppLockGate";
import { ScreenGuard } from "../src/components/ScreenGuard";
import { CallOverlay } from "../src/components/CallOverlay";
import { assertSecureForProduction, engine } from "../src/crypto";
import { setPlaybackAudioMode } from "../src/media/audioMode";
import { setupNotifications, getPushToken } from "../src/notify";
import { useApp } from "../src/state/store";
import { relay } from "../src/messaging/relay";

function ThemedStack() {
  const { colors, dark } = useTheme();
  return (
    <>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: "fade",
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding/index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="chat/[id]" options={{ animation: "slide_from_right" }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [loaded, error] = useSpace({
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });
  // Plasă de siguranță: nu rămâne NICIODATĂ blocat pe ecranul de încărcare.
  // 250ms (nu 2500) — dacă fonturile nu s-au încărcat până atunci, randăm UI-ul cu
  // fonturile de sistem și lăsăm cele custom să intre async (font swap). Pornire mult
  // mai rapidă: nu mai ținem ecran gol secunde întregi așteptând fonturile.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 250);
    return () => clearTimeout(t);
  }, []);

  // Așteaptă hidratarea store-ului din DB înainte de a randa conținutul — altfel
  // componentele se montează cu starea goală (conversations=[]) → flash de UI gol +
  // posibil crash. Plasă de siguranță 4s ca să nu blocheze dacă hidratarea atârnă
  // (guard-ul din store.setItem protejează oricum datele).
  const [hydrated, setHydrated] = useState(() => useApp.persist.hasHydrated());
  useEffect(() => {
    const unsub = useApp.persist.onFinishHydration(() => setHydrated(true));
    if (useApp.persist.hasHydrated()) setHydrated(true);
    const t = setTimeout(() => setHydrated(true), 4000);
    return () => { unsub(); clearTimeout(t); };
  }, []);

  useEffect(() => {
    assertSecureForProduction();
    setPlaybackAudioMode(); // sunet garantat pt voce/video/cerculețe
    if (useApp.getState().settings.notifications) {
      // push (FCM): cere permisiuni + ia token-ul + înregistrează-l la releu (Faza 4)
      (async () => {
        await setupNotifications();
        const tok = await getPushToken();
        if (tok) relay.registerPush(tok);
      })();
    }
    // mesaj primit prin releu (decriptat) → conversație + notificare
    relay.onMessage((fromDid, text, remoteId, senderName) => useApp.getState().receiveMessage(fromDid, text, remoteId, undefined, senderName));
  }, []);

  // conectează-te la releu când avem identitate — DAR întâi reîncarcă sesiunile (Faza 1),
  // altfel mesajele din conversații existente nu se mai pot decripta după restart.
  const identity = useApp((s) => s.identity);
  useEffect(() => {
    if (!identity) return;
    let cancelled = false;
    (async () => {
      await engine.loadSessions?.();
      if (!cancelled) relay.connect();
    })();
    return () => { cancelled = true; };
  }, [identity]);

  if ((!loaded && !error && !timedOut) || !hydrated) return <View style={{ flex: 1, backgroundColor: "#0A0C10" }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <I18nProvider>
          <ThemeProvider>
            <ScreenGuard />
            <AppLockGate>
              <ThemedStack />
            </AppLockGate>
            <CallOverlay />
          </ThemeProvider>
        </I18nProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
