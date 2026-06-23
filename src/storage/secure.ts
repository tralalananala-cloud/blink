/**
 * SecureStorage — singurul loc prin care trec cheile private / fraza de recuperare.
 *
 * Regula de aur: cheile NU ating niciodata AsyncStorage / MMKV / fisiere simple.
 * Doar Keystore (Android) prin expo-secure-store. In Faza 2, cheia bazei de date
 * SQLCipher se deriva tot de aici + biometrie.
 */
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export interface SecureStorage {
  setSecret(key: string, value: string): Promise<void>;
  getSecret(key: string): Promise<string | null>;
  deleteSecret(key: string): Promise<void>;
}

const OPTS: SecureStore.SecureStoreOptions = {
  // Cere autentificarea dispozitivului acolo unde e disponibil.
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

// Pe web/desktop (Electron) expo-secure-store nu există → fallback localStorage.
// Mai puțin sigur decât Keystore, dar e realitatea desktopului (documentat).
const isWeb = Platform.OS === "web";

export const secureStorage: SecureStorage = {
  async setSecret(key, value) {
    if (isWeb) { try { window.localStorage.setItem(key, value); } catch {} return; }
    await SecureStore.setItemAsync(key, value, OPTS);
  },
  async getSecret(key) {
    if (isWeb) { try { return window.localStorage.getItem(key); } catch { return null; } }
    return SecureStore.getItemAsync(key, OPTS);
  },
  async deleteSecret(key) {
    if (isWeb) { try { window.localStorage.removeItem(key); } catch {} return; }
    await SecureStore.deleteItemAsync(key, OPTS);
  },
};

export const KEYS = {
  identityPriv: "cipher.identity.priv",
  identityPub: "cipher.identity.pub",
  mnemonic: "cipher.identity.mnemonic",
  dbKey: "cipher.db.key",
} as const;
