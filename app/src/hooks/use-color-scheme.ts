import { useColorScheme as useDeviceColorScheme } from 'react-native';

import type { ColorScheme } from '@/constants/theme';
import { useThemeStore } from '@/store/theme';

/** The scheme the app renders in: the Settings choice, or the device appearance for `system`. */
export function useColorScheme(): ColorScheme {
  const preference = useThemeStore((s) => s.preference);
  const device = useDeviceColorScheme();
  if (preference !== 'system') return preference;
  return device === 'dark' ? 'dark' : 'light';
}
