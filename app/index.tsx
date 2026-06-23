import { useEffect, useState } from "react";
import { View } from "react-native";
import { Redirect } from "expo-router";
import { useApp } from "../src/state/store";
import { engine } from "../src/crypto";

/**
 * Poarta de pornire: restaurează identitatea existentă din SecureStorage.
 * Dacă există → sari onboarding-ul (NU mai genera cont nou la fiecare deschidere).
 */
export default function Index() {
  const onboarded = useApp((s) => s.onboarded);
  const setOnboarded = useApp((s) => s.setOnboarded);
  const setIdentity = useApp((s) => s.setIdentity);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    engine
      .loadIdentity()
      .then((id) => {
        if (id) {
          setIdentity(id);
          setOnboarded(true);
        }
      })
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return <View style={{ flex: 1, backgroundColor: "#0A0C10" }} />;
  return <Redirect href={onboarded ? "/(tabs)/chats" : "/onboarding"} />;
}
