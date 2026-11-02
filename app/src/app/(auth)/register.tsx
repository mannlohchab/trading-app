import { Link, router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, ApiError } from '@/lib/api';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth, type User } from '@/store/auth';

export default function RegisterScreen() {
  const setSession = useAuth((s) => s.setSession);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ user: User; accessToken: string; refreshToken: string }>(
        '/api/auth/register',
        { method: 'POST', body: { email, username, password }, auth: false },
      );
      await setSession(data);
      router.replace('/(tabs)/markets');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <Text style={styles.brand}>Create account</Text>
        <Text style={styles.subtitle}>Start with ₹10,00,000 virtual balance</Text>
        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput style={styles.input} autoCapitalize="none" value={email} onChangeText={setEmail} placeholderTextColor={Palette.textMuted} placeholder="you@email.com" />
          <Text style={styles.label}>Username</Text>
          <TextInput style={styles.input} autoCapitalize="none" value={username} onChangeText={setUsername} placeholderTextColor={Palette.textMuted} placeholder="trader_in" />
          <Text style={styles.label}>Password</Text>
          <TextInput style={styles.input} secureTextEntry value={password} onChangeText={setPassword} placeholderTextColor={Palette.textMuted} placeholder="min 8 characters" />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable style={styles.button} onPress={onSubmit} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Register</Text>}
          </Pressable>
          <Link href="/(auth)/login" style={styles.link}>
            Already have an account?
          </Link>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Palette.bg },
  wrap: { flex: 1, padding: Spacing.four, justifyContent: 'center', maxWidth: 420, width: '100%', alignSelf: 'center' },
  brand: { color: Palette.text, fontSize: 28, fontWeight: '800' },
  subtitle: { color: Palette.textSecondary, marginTop: 6, marginBottom: Spacing.five },
  form: { gap: Spacing.two },
  label: { color: Palette.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 8 },
  input: {
    backgroundColor: Palette.card,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: Palette.text,
    fontSize: 16,
  },
  button: {
    marginTop: Spacing.three,
    backgroundColor: Palette.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  error: { color: Palette.red, marginTop: 8 },
  link: { color: Palette.accent, textAlign: 'center', marginTop: 16, fontWeight: '600' },
});
