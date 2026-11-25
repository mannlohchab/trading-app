import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { Text } from '@/components/ui/AppText';

import { LaunchSplash } from '@/components/auth/LaunchSplash';
import { UpdateBanner } from '@/components/ui/UpdateBanner';
import { AppFont } from '@/constants/theme';
import { useColorScheme, usePalette } from '@/hooks/use-theme';
import { useAuth } from '@/store/auth';
import { setAuthProblemHandler } from '@/lib/api';
import { DEMO_MODE } from '@/lib/demoMode';
import { useThemeStore } from '@/store/theme';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 15_000 },
  },
});

export default function RootLayout() {
  const hydrate = useAuth((s) => s.hydrate);
  const hydrated = useAuth((s) => s.hydrated);
  const themeHydrated = useThemeStore((s) => s.hydrated);
  const scheme = useColorScheme();
  const Palette = usePalette();

  useEffect(() => {
    // Read the saved theme before the first frame so dark mode never flashes light.
    void Promise.all([hydrate(), useThemeStore.getState().hydrate()]).finally(() => SplashScreen.hideAsync());
  }, [hydrate]);

  // Web: the page behind the app, scrollbars and form controls follow the theme too.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    document.documentElement.style.colorScheme = scheme;
    document.documentElement.style.background = Palette.bg;
    document.body.style.background = Palette.bg;
    document.body.style.color = Palette.text;
  }, [scheme, Palette]);

  // The backend ended the session, or the account still needs its phone verified.
  useEffect(() => {
    setAuthProblemHandler((problem) => {
      if (problem === 'signed-out') {
        if (!useAuth.getState().user) return;
        useAuth.setState({ user: null });
        queryClient.clear();
        router.replace('/(auth)/login');
      } else {
        void useAuth.getState().refresh().then(() => router.replace('/(auth)/verify-phone'));
      }
    });
    return () => setAuthProblemHandler(undefined);
  }, []);

  if (!hydrated || !themeHydrated) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <View style={{ flex: 1, backgroundColor: Palette.bg }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Palette.bg },
          headerStyle: { backgroundColor: Palette.bgElevated },
          headerTintColor: Palette.text,
          headerTitleStyle: { fontFamily: AppFont, fontWeight: '700' },
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
        <Stack.Screen name="news" options={{ headerShown: true, title: 'Crypto news' }} />
        <Stack.Screen name="portfolio/holdings" options={{ headerShown: true, title: 'My holdings' }} />
      </Stack>
      <LaunchSplash />
      <UpdateBanner />
      </View>
      {DEMO_MODE && <View style={{ backgroundColor: Palette.card, paddingVertical: 6, paddingHorizontal: 12 }}>
        <Text style={{ color: Palette.accentText, fontSize: 10, textAlign: 'center' }}>Demo preview · Sample data · Changes reset on reload</Text>
      </View>}
      </View>
    </QueryClientProvider>
  );
}
