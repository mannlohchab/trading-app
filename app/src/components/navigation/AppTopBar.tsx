import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/AppText';
import { GlassIcon } from '@/components/ui/GlassIcon';
import { Palette } from '@/constants/theme';

const LOGO = { uri: 'https://i.pinimg.com/736x/b7/4a/b3/b74ab3b922824a6ccc26837cb6f4498b.jpg' };

type Props = {
  /** Brand tap. Defaults to opening Home; Home itself uses it to leave the market directory. */
  onBrandPress?: () => void;
};

/** The app's top bar (icon, name, Portfolio), shared by every main page. */
export function AppTopBar({ onBrandPress }: Props) {
  return (
    <View style={styles.header}>
      <View style={styles.brand}>
        <Image source={LOGO} style={styles.logo} contentFit="cover" accessibilityLabel="Gurukul icon" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Gurukul home"
          accessibilityHint="Return to the homepage"
          style={({ pressed }) => [styles.brandHome, pressed && { opacity: 0.65 }]}
          onPress={onBrandPress ?? (() => router.navigate('/(tabs)/markets'))}>
          <Text style={styles.brandName}>Gurukul</Text>
        </Pressable>
      </View>
      <View style={styles.actions}>
        {/* No notification feed yet: the bell opens the notification preference in Profile settings. */}
        <Pressable accessibilityRole="button" accessibilityLabel="Notifications" accessibilityHint="Open notification settings" hitSlop={4}
          style={({ pressed }) => [styles.bellButton, pressed && { opacity: 0.65 }]}
          onPress={() => router.navigate({ pathname: '/(tabs)/profile', params: { tab: 'Settings', at: String(Date.now()) } })}>
          <GlassIcon name="bell" size={24} tone="purple" />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Open portfolio" style={styles.portfolioPill} onPress={() => router.navigate('/(tabs)/profile')}>
          <Text style={styles.portfolioText}>Portfolio</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 16, paddingBottom: 24,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  logo: { width: 36, height: 36, borderRadius: 9, backgroundColor: Palette.card },
  brandName: { color: Palette.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.5 },
  brandHome: { minHeight: 44, justifyContent: 'center' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bellButton: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border,
  },
  portfolioPill: {
    borderWidth: 1, borderColor: '#0066FF', backgroundColor: Palette.card,
    borderRadius: 20, paddingHorizontal: 16, minHeight: 36, justifyContent: 'center',
  },
  portfolioText: { color: Palette.text, fontWeight: '500', fontSize: 11 },
});
