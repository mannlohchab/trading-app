import { Redirect, Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassIcon } from '@/components/ui/GlassIcon';
import { AppFont, Palette } from '@/constants/theme';
import { useAuth } from '@/store/auth';

export default function AppTabs() {
  const user = useAuth((state) => state.user);
  const insets = useSafeAreaInsets();
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
        tabBarActiveBackgroundColor: '#FFFFFF',
        tabBarInactiveBackgroundColor: '#FFFFFF',
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
        sceneStyle: { backgroundColor: '#FFFFFF' },
        tabBarIcon: ({ focused }) => <GlassIcon size={26} name="chart" tone={focused ? 'purple' : 'neutral'} />,
      }} />
      <Tabs.Screen name="community" options={{
        title: 'Community',
        tabBarIcon: ({ focused }) => <GlassIcon size={26} name="community" tone={focused ? 'purple' : 'neutral'} />,
      }} />
      <Tabs.Screen name="ai" options={{
        title: 'Insights',
        sceneStyle: { backgroundColor: '#FFFFFF' },
        // Full-screen chat: the header's home button replaces the dock.
        tabBarStyle: { display: 'none' },
        tabBarIcon: ({ focused }) => <GlassIcon size={26} name="analytics" tone={focused ? 'purple' : 'neutral'} />,
      }} />
      <Tabs.Screen name="profile" options={{
        title: 'Profile',
        sceneStyle: { backgroundColor: '#FFFFFF' },
        tabBarIcon: ({ focused }) => <GlassIcon size={26} name="profile" tone={focused ? 'purple' : 'neutral'} />,
      }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: '#FFFFFF',
    borderTopWidth: 0,
    paddingTop: 10, paddingHorizontal: 8, elevation: 0, boxShadow: 'none',
  },
  item: { paddingVertical: 0, minHeight: 44 },
  iconSlot: { width: 28, height: 28, marginBottom: 2 },
  label: { fontFamily: AppFont, fontSize: 11, lineHeight: 15, fontWeight: '400', marginTop: 2 },
});
