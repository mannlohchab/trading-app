import { Link, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/AppText';
import { SafeAreaView } from 'react-native-safe-area-context';

import { authClient } from '@/lib/authClient';
import { Palette, Spacing } from '@/constants/theme';
import { useAuth } from '@/store/auth';

export default function RegisterScreen() {
  const refresh = useAuth((s) => s.refresh);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setLoading(true);
    setError(null);
    try {
      if (!name.trim()) { setError('Enter your name.'); return; }
      if (password.length < 8) { setError('Use at least 8 characters for your password.'); return; }
      const { error: signUpError } = await authClient.signUp.email({ name: name.trim(), email: email.trim(), password });
      if (signUpError) { setError(signUpError.message || 'Registration failed'); return; }
      await refresh();
      // New accounts verify a phone number before they become active.
      router.replace('/(auth)/verify-phone');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <Text style={styles.brand}>Create account</Text>
        <Text style={styles.subtitle}>Practice with 100,000 virtual USDT on live crypto prices</Text>
        <View style={styles.form}>
          <Text style={styles.label}>Name</Text>
          <TextInput accessibilityLabel="Name" style={styles.input} value={name} onChangeText={setName} autoComplete="name" placeholderTextColor={Palette.textMuted} placeholder="Your name" />
          <Text style={styles.label}>Email</Text>
          <TextInput accessibilityLabel="Email" style={styles.input} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} placeholderTextColor={Palette.textMuted} placeholder="you@email.com" />
          <Text style={styles.label}>Password</Text>
          <TextInput accessibilityLabel="Password" style={styles.input} secureTextEntry autoComplete="new-password" value={password} onChangeText={setPassword} placeholderTextColor={Palette.textMuted} placeholder="min 8 characters" />
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
