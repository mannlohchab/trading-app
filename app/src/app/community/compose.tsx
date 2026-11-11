import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';

import { InsightPalette as Palette, Spacing } from '@/constants/theme';
import { api } from '@/lib/api';
import { COMMUNITY_API, refreshCommunity } from '@/lib/community';
import { ErrorBanner } from '@/components/ui/ErrorBanner';

export default function ComposeScreen() {
  const client = useQueryClient();
  const [imageError, setImageError] = useState('');
  const [content, setContent] = useState('');
  const [symbol, setSymbol] = useState('');
  const [imageUrl, setImageUrl] = useState<string | undefined>();

  const mutation = useMutation({
    mutationFn: () =>
      api(`${COMMUNITY_API}/posts`, {
        method: 'POST',
        body: {
          content: content.trim(),
          // The server resolves pair aliases (BTC/USDT, EURUSD) to their canonical exchange.
          symbol: symbol.trim() || undefined,
          // Base64 data URL; the server checks the real format and size.
          image: imageUrl,
        },
      }),
    onSuccess: async () => {
      await refreshCommunity(client);
      router.back();
    },
  });

  async function pickImage() {
    setImageError('');
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 0.6, base64: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.base64) throw new Error('Unable to read this image. Please select another.');
      if (asset.base64.length > 1_800_000) throw new Error('This image is too large. Choose a smaller image (under 1.3 MB).');
      setImageUrl(`data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}`);
    } catch (err) { setImageError(err instanceof Error ? err.message : 'Unable to select an image.'); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerStyle: { backgroundColor: Palette.bg },
          headerTintColor: Palette.text,
          headerRight: () => (
            <Pressable accessibilityRole="button" onPress={() => mutation.mutate()} disabled={!content.trim() || mutation.isPending}>
              <Text style={[styles.postBtn, (!content.trim() || mutation.isPending) && { opacity: 0.4 }]}>{mutation.isPending ? 'Publishing…' : 'Publish'}</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView keyboardShouldPersistTaps="handled">
        {mutation.error && <ErrorBanner message={mutation.error.message || 'Could not publish your post.'} />}
        {imageError ? <ErrorBanner message={imageError} /> : null}
        <TextInput
          accessibilityLabel="Post content"
          editable={!mutation.isPending}
          maxLength={5000}
          style={styles.input}
          multiline
          autoFocus
          placeholder="Share a market idea, chart takeaway, or question…"
          placeholderTextColor={Palette.textMuted}
          value={content}
          onChangeText={setContent}
        />
        <Text style={styles.counter}>{content.length}/5000</Text>
        <View style={styles.row}>
          <TextInput
            accessibilityLabel="Attach market symbol"
            editable={!mutation.isPending}
            style={styles.symbol}
            placeholder="Attach symbol (e.g. BTCUSDT or EUR/USD)"
            placeholderTextColor={Palette.textMuted}
            autoCapitalize="characters"
            value={symbol}
            onChangeText={setSymbol}
          />
          <Pressable accessibilityRole="button" disabled={mutation.isPending} style={styles.imgBtn} onPress={pickImage}>
            <Text style={styles.imgBtnText}>Image</Text>
          </Pressable>
        </View>
        {imageUrl ? <View>
          <Image source={{ uri: imageUrl }} style={styles.preview} resizeMode="contain" accessibilityLabel="Selected attachment" />
          <Pressable accessibilityRole="button" disabled={mutation.isPending} onPress={() => setImageUrl(undefined)} style={styles.removeImage}><Text style={styles.imgBtnText}>Remove image</Text></Pressable>
        </View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  counter: { color: Palette.textMuted, fontSize: 12, textAlign: 'right', marginTop: 6 },
  removeImage: { minHeight: 44, justifyContent: 'center' },
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
