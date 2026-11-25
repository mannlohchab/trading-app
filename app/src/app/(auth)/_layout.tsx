import { Stack } from 'expo-router';

import { usePalette } from '@/hooks/use-theme';

export default function AuthLayout() {
  const Palette = usePalette();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Palette.bg },
      }}
    />
  );
}
