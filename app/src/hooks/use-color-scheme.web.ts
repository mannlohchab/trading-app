import { useEffect, useState } from 'react';
import { useColorScheme as useDeviceColorScheme } from 'react-native';

import type { ColorScheme } from '@/constants/theme';
import { useThemeStore } from '@/store/theme';

/**
 * The scheme the app renders in. Server rendering has no device appearance, so `system` renders
 * light until the client hydrates.
 */
export function useColorScheme(): ColorScheme {
  const [hasHydrated, setHasHydrated] = useState(false);
  useEffect(() => setHasHydrated(true), []);

  const preference = useThemeStore((s) => s.preference);
  const device = useDeviceColorScheme();
  if (preference !== 'system') return preference;
  return hasHydrated && device === 'dark' ? 'dark' : 'light';
}
