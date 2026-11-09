import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Text } from '@/components/ui/AppText';
import { Palette } from '@/constants/theme';

type Props = { visible: boolean; onClose: () => void };

/** Opening offer. The gift is the visual; the balance is the paper account people already receive. */
export function WelcomeGift({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss welcome" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 16) }]} accessibilityViewIsModal>
          <View style={styles.wash} pointerEvents="none" />
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} style={styles.close} onPress={onClose}>
            <Text style={styles.closeGlyph}>×</Text>
          </Pressable>
          <Image source={require('@/assets/images/welcome-gift.png')} style={styles.gift} contentFit="contain" accessibilityLabel="Gift" />
          <Text style={styles.title} accessibilityRole="header">100,000 virtual USDT</Text>
          <Text style={styles.body}>Your paper balance is ready.</Text>
          <Text style={styles.body}>Trade live crypto prices. This money is not real.</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Start trading" style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={onClose}>
            <Text style={styles.buttonText}>Start trading</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: Palette.overlay, justifyContent: 'flex-end' },
  card: {
    width: '100%', borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: '#FFFFFF',
    alignItems: 'center', paddingHorizontal: 22, paddingTop: 18, overflow: 'hidden',
  },
  wash: { position: 'absolute', top: 0, left: 0, right: 0, height: 150, backgroundColor: '#F4F1FF' },
  close: { position: 'absolute', top: 10, right: 10, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  closeGlyph: { color: Palette.textSecondary, fontSize: 28, lineHeight: 30 },
  gift: { width: 168, height: 168, marginTop: 8 },
  title: { color: Palette.text, fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.4, textAlign: 'center', marginTop: 4 },
  body: { color: Palette.textSecondary, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 6, maxWidth: 280 },
  button: { alignSelf: 'stretch', minHeight: 52, borderRadius: 26, backgroundColor: '#16181D', alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.7 },
});
