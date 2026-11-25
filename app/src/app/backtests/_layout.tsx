import { Redirect, Stack } from 'expo-router';
import { AppFont, InsightPalette as P } from '@/constants/theme';
import { useAuth } from '@/store/auth';

export default function BacktestingLayout() {
  const user = useAuth(state => state.user);
  const hydrated = useAuth(state => state.hydrated);
  if (!hydrated) return null;
  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.status === 'PENDING_PHONE_VERIFICATION') return <Redirect href="/(auth)/verify-phone" />;
  return <Stack screenOptions={{ headerShown: true, headerStyle: { backgroundColor: P.bg }, headerTintColor: P.text,
    headerTitleStyle: { fontFamily: AppFont }, headerShadowVisible: false, contentStyle: { backgroundColor: P.bg } }}>
    <Stack.Screen name="index" options={{ title: 'Backtesting' }} />
    <Stack.Screen name="[id]" options={{ title: 'Backtest results' }} />
    <Stack.Screen name="research" options={{ title: 'Research workspace' }} />
    <Stack.Screen name="live/[id]" options={{ title: 'Live paper test' }} />
  </Stack>;
}
