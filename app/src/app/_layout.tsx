import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Text, View } from 'react-native';

import { Palette } from '@/constants/theme';
import { useAuth } from '@/store/auth';
import { DEMO_MODE } from '@/lib/demoMode';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000 },
  },
});

export default function RootLayout() {
  const hydrate = useAuth((s) => s.hydrate);
  const hydrated = useAuth((s) => s.hydrated);

  useEffect(() => {
    void hydrate().finally(() => SplashScreen.hideAsync());
  }, [hydrate]);

  if (!hydrated) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <View style={{ flex: 1 }}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Palette.bg },
          headerStyle: { backgroundColor: Palette.bgElevated },
          headerTintColor: Palette.text,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
        }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="instrument/[symbol]"
          options={{ headerShown: true, title: 'Chart', presentation: 'card' }}
        />
        <Stack.Screen
          name="community/compose"
          options={{ presentation: 'modal', headerShown: true, title: 'New post' }}
        />
        <Stack.Screen name="community/post/[id]" options={{ headerShown: true, title: 'Post' }} />
      </Stack>
      {DEMO_MODE && <View style={{ backgroundColor: '#eee9fa', paddingVertical: 6, paddingHorizontal: 12 }}>
        <Text style={{ color: '#655187', fontSize: 10, textAlign: 'center' }}>Demo preview · Sample data · Changes reset on reload</Text>
      </View>}
      </View>
    </QueryClientProvider>
  );
}
