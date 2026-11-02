import { useMutation } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Alert, Image, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InsightPalette as Palette, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';

export default function ComposeScreen() {
  const [content, setContent] = useState('');
  const [symbol, setSymbol] = useState('');
  const [imageUrl, setImageUrl] = useState<string | undefined>();

  const mutation = useMutation({
    mutationFn: () =>
      api('/api/community/posts', {
        method: 'POST',
        body: {
          content,
          // The server resolves pair aliases (BTC/USDT, EURUSD) to their canonical exchange.
          symbol: symbol.trim() || undefined,
          imageUrl,
        },
      }),
    onSuccess: () => {
      router.back();
    },
    onError: (err) => Alert.alert('Failed', err instanceof Error ? err.message : 'Could not post'),
  });

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled && result.assets[0]?.base64) {
      const mime = result.assets[0].mimeType ?? 'image/jpeg';
      setImageUrl(`data:${mime};base64,${result.assets[0].base64}`);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerStyle: { backgroundColor: Palette.bg },
          headerTintColor: Palette.text,
          headerRight: () => (
            <Pressable onPress={() => mutation.mutate()} disabled={!content.trim() || mutation.isPending}>
              <Text style={[styles.postBtn, (!content.trim() || mutation.isPending) && { opacity: 0.4 }]}>Publish</Text>
            </Pressable>
          ),
        }}
      />
      <TextInput
        style={styles.input}
        multiline
        autoFocus
        placeholder="Share a market idea, chart takeaway, or question…"
        placeholderTextColor={Palette.textMuted}
        value={content}
        onChangeText={setContent}
      />
      <View style={styles.row}>
        <TextInput
          style={styles.symbol}
          placeholder="Attach symbol (e.g. BTCUSDT or EUR/USD)"
          placeholderTextColor={Palette.textMuted}
          autoCapitalize="characters"
          value={symbol}
          onChangeText={setSymbol}
        />
        <Pressable style={styles.imgBtn} onPress={pickImage}>
          <Text style={styles.imgBtnText}>Image</Text>
        </Pressable>
      </View>
      {imageUrl ? <Image source={{ uri: imageUrl }} style={styles.preview} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: Palette.bg, padding: Spacing.three },
  input: {
    minHeight: 160,
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 16,
    padding: 14,
    color: Palette.text,
    fontSize: 16,
    lineHeight: 24,
    textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', gap: 8, marginTop: 12 },
  symbol: {
    flex: 1,
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: Palette.text,
  },
  imgBtn: {
    backgroundColor: Palette.soft,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  imgBtnText: { color: Palette.accent, fontWeight: '700' },
  preview: { marginTop: 12, width: '100%', height: 180, borderRadius: 12 },
  postBtn: { color: Palette.accent, fontWeight: '800', marginRight: 4 },
});
