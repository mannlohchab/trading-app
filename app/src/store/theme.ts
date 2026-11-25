import AsyncStorage from '@react-native-async-storage/async-storage';
import { Appearance, Platform } from 'react-native';
import { create } from 'zustand';

/** What the user picked in Settings. `system` follows the device appearance. */
export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'tradinggurukul.themePreference';

function isPreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Native pickers, alerts, keyboards and switches follow the app's choice, not just our own views. */
function applyNativeOverride(preference: ThemePreference) {
  if (Platform.OS === 'web') return;
  try {
    Appearance.setColorScheme(preference === 'system' ? 'unspecified' : preference);
  } catch { /* older native module: our own views still follow the preference */ }
}

type ThemeState = {
  preference: ThemePreference;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setPreference: (preference: ThemePreference) => void;
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: 'system',
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    let preference: ThemePreference = 'system';
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (isPreference(stored)) preference = stored;
    } catch { /* unreadable storage: follow the system */ }
    applyNativeOverride(preference);
    set({ preference, hydrated: true });
  },
  setPreference: (preference) => {
    applyNativeOverride(preference);
    set({ preference });
    void AsyncStorage.setItem(STORAGE_KEY, preference).catch(() => { /* applies for this launch anyway */ });
  },
}));
