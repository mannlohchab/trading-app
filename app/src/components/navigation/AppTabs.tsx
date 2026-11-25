import { Redirect, Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassIcon } from '@/components/ui/GlassIcon';
import { AppFont } from '@/constants/theme';
import { makeStyles, useInsightPalette, usePalette } from '@/hooks/use-theme';
import { useAuth } from '@/store/auth';

export default function AppTabs() {
  const user = useAuth((state) => state.user);
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const Palette = usePalette();
  const InsightPalette = useInsightPalette();
  const bottomPadding = Math.max(insets.bottom, 12);

  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.status !== 'ACTIVE') return <Redirect href="/(auth)/verify-phone" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: Palette.bg },
        tabBarStyle: [styles.bar, { height: 62 + bottomPadding, paddingBottom: bottomPadding }],
        tabBarItemStyle: styles.item,
        tabBarIconStyle: styles.iconSlot,
        tabBarLabelStyle: styles.label,
        tabBarLabelPosition: 'below-icon',
        tabBarActiveTintColor: Palette.text,
        tabBarInactiveTintColor: Palette.textSecondary,
        tabBarActiveBackgroundColor: Palette.bgElevated,
        tabBarInactiveBackgroundColor: Palette.bgElevated,
        tabBarHideOnKeyboard: true,
        // Hidden tabs keep receiving live prices; freezing skips their re-renders until refocused.
        freezeOnBlur: true,
      }}>
      <Tabs.Screen name="markets" options={{
        title: 'Home',
        tabBarIcon: ({ focused }) => <GlassIcon size={26} name="home" tone={focused ? 'purple' : 'neutral'} />,
      }} />
      <Tabs.Screen name="market" options={{
        title: 'Market',
        sceneStyle: { backgroundColor: InsightPalette.bgElevated },
        tabBarIcon: ({ focused }) => <GlassIcon size={26} name="chart" tone={focused ? 'purple' : 'neutral'} />,
      }} />
      <Tabs.Screen name="ai" options={{
        title: 'Insights',
        sceneStyle: { backgroundColor: InsightPalette.bgElevated },
        // Full-screen chat: the header's home button replaces the dock.
        tabBarStyle: { display: 'none' },
        tabBarIcon: ({ focused }) => <GlassIcon size={26} name="analytics" tone={focused ? 'purple' : 'neutral'} />,
      }} />
      <Tabs.Screen name="calendar" options={{
        title: 'Calendar',
        tabBarIcon: ({ focused }) => <GlassIcon size={26} name="calendar" tone={focused ? 'purple' : 'neutral'} />,
      }} />
      <Tabs.Screen name="community" options={{
        title: 'Community',
        tabBarIcon: ({ focused }) => <GlassIcon size={26} name="community" tone={focused ? 'purple' : 'neutral'} />,
      }} />
      <Tabs.Screen name="profile" options={{
        title: 'Profile',
        // Opened from the top bar, so it has no dock button. Not `href: null`: Expo Router 58 marks
        // that tab hidden and redirects every visit to it back to Home.
        tabBarButton: () => null,
        // The tab bar still wraps each button in a `flex: 1` slot; hide it so the dock has no gap.
        tabBarItemStyle: { display: 'none' },
        sceneStyle: { backgroundColor: InsightPalette.bgElevated },
      }} />
    </Tabs>
  );
}

const useStyles = makeStyles((Palette) => ({
  bar: {
    width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: Palette.bgElevated,
    borderTopWidth: 0,
    paddingTop: 10, paddingHorizontal: 8, elevation: 0, boxShadow: 'none',
  },
  item: { paddingVertical: 0, minHeight: 44 },
  iconSlot: { width: 28, height: 28, marginBottom: 2 },
  label: { fontFamily: AppFont, fontSize: 11, lineHeight: 15, fontWeight: '400', marginTop: 2 },
}));
