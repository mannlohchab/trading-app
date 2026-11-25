import { Link, router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/ui/AppText';
import { authClient } from '@/lib/authClient';
import { useAuth } from '@/store/auth';
import { makeStyles, usePalette } from '@/hooks/use-theme';

export default function RegisterScreen() {
  const styles = useStyles();
  const Palette = usePalette();
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
    <View style={styles.screen}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
          <Text accessibilityRole="header" style={styles.brand}>Create account</Text>
          <Text style={styles.subtitle}>Practice with 100,000 virtual USDT on live crypto prices</Text>
          <View style={styles.form}>
            <Text style={styles.label}>Name</Text>
            <TextInput accessibilityLabel="Name" style={styles.input} value={name} onChangeText={setName} autoComplete="name" placeholderTextColor={Palette.textMuted} placeholder="Your name" />
            <Text style={styles.label}>Email</Text>
            <TextInput accessibilityLabel="Email" style={styles.input} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" value={email} onChangeText={setEmail} placeholderTextColor={Palette.textMuted} placeholder="you@email.com" />
            <Text style={styles.label}>Password</Text>
            <TextInput accessibilityLabel="Password" style={styles.input} secureTextEntry autoComplete="new-password" value={password} onChangeText={setPassword} placeholderTextColor={Palette.textMuted} placeholder="min 8 characters" />
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={onSubmit} disabled={loading}>
              {loading ? <ActivityIndicator color={Palette.onInverse} /> : <Text style={styles.buttonText}>Create account</Text>}
            </Pressable>
            <Link href="/(auth)/login" style={styles.link}>
              I already have an account
            </Link>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const useStyles = makeStyles((Palette, _, scheme) => {
  const dark = scheme === 'dark';
  return {
    screen: { flex: 1, backgroundColor: dark ? Palette.bg : '#F2EDEA' },
    safe: { flex: 1 },
    wrap: { flex: 1, padding: 24, justifyContent: 'center', maxWidth: 420, width: '100%', alignSelf: 'center' },
    brand: { color: Palette.text, fontSize: 32, fontWeight: '600', letterSpacing: -0.8 },
    subtitle: { color: dark ? Palette.textSecondary : '#5C6578', fontSize: 15, lineHeight: 21, marginTop: 8, marginBottom: 28 },
    form: { gap: 8 },
    label: { color: dark ? Palette.textSecondary : '#5C6578', fontSize: 13, fontWeight: '600', marginTop: 8 },
    input: {
      backgroundColor: Palette.card,
      borderWidth: 1,
      borderColor: dark ? Palette.border : '#E4DDD8',
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: Palette.text,
      fontSize: 16,
      minHeight: 48,
    },
    button: {
      marginTop: 16,
      backgroundColor: Palette.inverse,
      borderRadius: 14,
      minHeight: 52,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: { opacity: 0.72 },
    buttonText: { color: Palette.onInverse, fontWeight: '600', fontSize: 16 },
    error: { color: Palette.red, marginTop: 8 },
    link: { color: Palette.accent, textAlign: 'center', marginTop: 16, fontWeight: '600', paddingVertical: 12 },
  };
});
