import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/ui/AppText';
import { Palette, Spacing } from '@/constants/theme';
import { authClient } from '@/lib/authClient';
import { useAuth } from '@/store/auth';

const E164 = /^\+[1-9]\d{7,14}$/;

/** Step two of sign-up: the backend activates an account once a phone number is verified by OTP. */
export default function VerifyPhoneScreen() {
  const user = useAuth((s) => s.user);
  const refresh = useAuth((s) => s.refresh);
  const signOut = useAuth((s) => s.signOut);
  const [phone, setPhone] = useState(user?.phoneNumber ?? '+91');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.status === 'ACTIVE') return <Redirect href="/(tabs)/markets" />;

  const number = phone.replace(/[\s()-]/g, '');

  async function sendCode() {
    if (!E164.test(number)) { setError('Enter the number in international format, e.g. +919876543210.'); return; }
    setLoading(true);
    setError(null);
    try {
      const { error: sendError } = await authClient.phoneNumber.sendOtp({ phoneNumber: number });
      if (sendError) { setError(sendError.message || 'Could not send the code.'); return; }
      setSentTo(number);
      setCode('');
      setCooldown(60);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function verify() {
    if (!sentTo || !/^\d{6}$/.test(code)) { setError('Enter the 6-digit code.'); return; }
    setLoading(true);
    setError(null);
    try {
      const { error: verifyError } = await authClient.phoneNumber.verify({ phoneNumber: sentTo, code });
      if (verifyError) { setError(verifyError.message || 'That code did not work.'); return; }
      const next = await refresh();
      if (next?.status === 'ACTIVE') router.replace('/(tabs)/markets');
      else setError('Your number is verified, but the account is not active yet. Please try again shortly.');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  async function switchAccount() {
    await signOut();
    router.replace('/(auth)/login');
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <Text accessibilityRole="header" style={styles.brand}>Verify your phone</Text>
        <Text style={styles.subtitle}>
          {sentTo ? `Enter the 6-digit code sent to ${sentTo}.` : `One last step for ${user.email}. We'll text you a code.`}
        </Text>
        <View style={styles.form}>
          <Text style={styles.label}>Phone number</Text>
          <TextInput accessibilityLabel="Phone number" style={styles.input} value={phone} onChangeText={setPhone} editable={!loading}
            keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" placeholder="+919876543210" placeholderTextColor={Palette.textMuted} />
          {sentTo ? (
            <>
              <Text style={styles.label}>Code</Text>
              <TextInput accessibilityLabel="Verification code" style={[styles.input, styles.code]} value={code} editable={!loading}
                onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="sms-otp"
                textContentType="oneTimeCode" maxLength={6} placeholder="123456" placeholderTextColor={Palette.textMuted} onSubmitEditing={() => void verify()} />
            </>
          ) : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Pressable accessibilityRole="button" style={[styles.button, loading && styles.disabled]} disabled={loading}
            onPress={() => void (sentTo ? verify() : sendCode())}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{sentTo ? 'Verify' : 'Send code'}</Text>}
          </Pressable>
          {sentTo ? (
            <Pressable accessibilityRole="button" disabled={loading || cooldown > 0} onPress={() => void sendCode()}>
              <Text style={[styles.link, (loading || cooldown > 0) && styles.disabled]}>{cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}</Text>
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" onPress={() => void switchAccount()}>
            <Text style={styles.secondaryLink}>Use a different account</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Palette.bg },
  wrap: { flex: 1, padding: Spacing.four, justifyContent: 'center', maxWidth: 420, width: '100%', alignSelf: 'center' },
  brand: { color: Palette.text, fontSize: 28, fontWeight: '800' },
  subtitle: { color: Palette.textSecondary, marginTop: 6, marginBottom: Spacing.five, lineHeight: 20 },
  form: { gap: Spacing.two },
  label: { color: Palette.textSecondary, fontSize: 12, fontWeight: '600', marginTop: 8 },
  input: {
    backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, color: Palette.text, fontSize: 16,
  },
  code: { fontSize: 22, letterSpacing: 6, fontVariant: ['tabular-nums'] },
  button: { marginTop: Spacing.three, backgroundColor: Palette.accent, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  disabled: { opacity: 0.5 },
  error: { color: Palette.red, marginTop: 8 },
  link: { color: Palette.accent, textAlign: 'center', marginTop: 16, fontWeight: '600', paddingVertical: 8 },
  secondaryLink: { color: Palette.textSecondary, textAlign: 'center', marginTop: 4, paddingVertical: 8 },
});
