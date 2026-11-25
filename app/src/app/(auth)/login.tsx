import { Image } from 'expo-image';
import { Link, router, useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text, TextInput } from '@/components/ui/AppText';
import { SwipeButton, type SwipeButtonHandle } from '@/components/ui/SwipeButton';
import { authClient } from '@/lib/authClient';
import { DEMO_MODE } from '@/lib/demoMode';
import { demoApi } from '@/lib/demoData';
import { useAuth, type User } from '@/store/auth';
import { makeStyles, useColorScheme, usePalette } from '@/hooks/use-theme';

export default function LoginScreen() {
  const styles = useStyles();
  const Palette = usePalette();
  const scheme = useColorScheme();
  const setSession = useAuth((s) => s.setSession);
  const refresh = useAuth((s) => s.refresh);
  const [showLogin, setShowLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const nextRoute = useRef<'/(tabs)/markets' | '/(auth)/verify-phone'>('/(tabs)/markets');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedAction, setFocusedAction] = useState<'start' | 'account' | null>(null);
  const submitting = useRef(false);
  const swipeButton = useRef<SwipeButtonHandle>(null);
  const onSignInSuccess = useCallback(() => router.replace(nextRoute.current), []);

  useFocusEffect(useCallback(() => {
    const style = scheme === 'dark' ? 'light' : 'dark';
    setStatusBarStyle(style);
    return () => setStatusBarStyle(style);
  }, [scheme]));

  async function onSubmit() {
    if (submitting.current) return false;
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      if (DEMO_MODE) {
        await setSession(demoApi.session() as unknown as { user: User });
        return true;
      }
      const { error: signInError } = await authClient.signIn.email({ email: email.trim(), password });
      if (signInError) {
        setError(signInError.message || 'Email or password is incorrect.');
        return false;
      }
      const user = await refresh();
      if (!user) {
        setError('Signed in, but the session could not be loaded. Please try again.');
        return false;
      }
      nextRoute.current = user.status === 'ACTIVE' ? '/(tabs)/markets' : '/(auth)/verify-phone';
      return true;
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      return false;
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <View style={styles.screen}>
      <SafeAreaView style={styles.safe}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
          <ScrollView
            contentContainerStyle={[styles.wrap, showLogin && styles.loginWrap]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {showLogin ? (
              <View style={styles.form}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back to welcome"
                  onPress={() => { setShowLogin(false); setError(null); }}
                  style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}>
                  <Text style={styles.backText}>Back</Text>
                </Pressable>
                <Text accessibilityRole="header" style={styles.formTitle}>Welcome back</Text>
                <Text style={styles.formSubtitle}>Log in to TradingGurukul</Text>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  accessibilityLabel="Email"
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  placeholderTextColor={Palette.textMuted}
                  autoComplete="email"
                  placeholder="you@email.com"
                />
                <Text style={styles.label}>Password</Text>
                <TextInput
                  accessibilityLabel="Password"
                  style={styles.input}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  placeholderTextColor={Palette.textMuted}
                  autoComplete="current-password"
                  returnKeyType="go"
                  onSubmitEditing={() => { void swipeButton.current?.submit(); }}
                  placeholder="••••••••"
                />
                {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
                <SwipeButton ref={swipeButton} loading={loading} onSwipeComplete={onSubmit} onSuccess={onSignInSuccess} />
                {DEMO_MODE ? <Text style={styles.hint}>Demo preview: any details sign you in</Text> : null}
                <Link href="/(auth)/register" style={styles.link}>
                  Create an account
                </Link>
              </View>
            ) : (
              <View style={styles.welcome}>
                <Text style={styles.wordmark}>Gurukul</Text>
                <View style={styles.stage} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                  <Image
                    source={require('@/assets/images/login-safe.png')}
                    style={styles.hero}
                    contentFit="contain"
                    accessible={false}
                  />
                  <Image source={require('@/assets/images/login-chart.png')} style={[styles.orbit, styles.chart]} contentFit="contain" accessible={false} />
                  <Image source={require('@/assets/images/login-piggy.png')} style={[styles.orbit, styles.piggy]} contentFit="contain" accessible={false} />
                  <Image source={require('@/assets/images/login-cash.png')} style={[styles.orbit, styles.cash]} contentFit="contain" accessible={false} />
                  <Image source={require('@/assets/images/login-wallet.png')} style={[styles.orbit, styles.wallet]} contentFit="contain" accessible={false} />
                </View>
                <View style={styles.copy}>
                  <Text accessibilityRole="header" style={styles.title}>Forex and crypto,</Text>
                  <Text style={styles.titleSoft}>side by side.</Text>
                  <Text style={styles.description}>
                    Practice on live prices, with 100,000 virtual USDT to start.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onFocus={() => setFocusedAction('start')}
                    onBlur={() => setFocusedAction((current) => (current === 'start' ? null : current))}
                    style={({ pressed }) => [styles.primary, pressed && styles.pressed, focusedAction === 'start' && styles.focused]}
                    onPress={() => router.push('/(auth)/register')}>
                    <Text style={styles.primaryText}>Get started</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onFocus={() => setFocusedAction('account')}
                    onBlur={() => setFocusedAction((current) => (current === 'account' ? null : current))}
                    style={({ pressed }) => [styles.secondary, pressed && styles.pressed, focusedAction === 'account' && styles.focused]}
                    onPress={() => setShowLogin(true)}>
                    <Text style={styles.secondaryText}>I already have an account</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </ScrollView>
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
    wrap: { flexGrow: 1, maxWidth: 460, width: '100%', alignSelf: 'center' },
    loginWrap: { justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 24 },
    welcome: { flexGrow: 1, paddingBottom: 12 },
    wordmark: {
      color: Palette.text,
      fontSize: 16,
      fontWeight: '600',
      letterSpacing: -0.3,
      textAlign: 'center',
      paddingTop: 8,
    },
    stage: { flex: 1, minHeight: 280 },
    hero: { width: '86%', height: '86%', alignSelf: 'center', marginTop: '6%' },
    orbit: { position: 'absolute' },
    chart: { width: '30%', aspectRatio: 1, top: '2%', left: '1%' },
    piggy: { width: '32%', aspectRatio: 1, top: '4%', right: '0%' },
    cash: { width: '24%', aspectRatio: 1, bottom: '14%', left: '3%' },
    wallet: { width: '34%', aspectRatio: 670 / 663, bottom: '8%', right: '0%' },
    copy: { paddingHorizontal: 22, paddingBottom: 8 },
    title: {
      color: Palette.text,
      fontSize: 34,
      lineHeight: 38,
      fontWeight: '600',
      letterSpacing: -1.1,
      textAlign: 'center',
    },
    titleSoft: {
      color: Palette.text,
      fontSize: 34,
      lineHeight: 38,
      fontWeight: '400',
      letterSpacing: -1.1,
      textAlign: 'center',
    },
    description: {
      color: dark ? Palette.textSecondary : '#5C6578',
      fontSize: 15,
      lineHeight: 21,
      textAlign: 'center',
      marginTop: 12,
      marginBottom: 22,
      paddingHorizontal: 12,
    },
    primary: {
      backgroundColor: Palette.inverse,
      borderRadius: 14,
      minHeight: 52,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: Palette.inverse,
    },
    primaryText: { color: Palette.onInverse, fontSize: 16, fontWeight: '600' },
    secondary: {
      marginTop: 10,
      backgroundColor: Palette.card,
      borderRadius: 14,
      minHeight: 52,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: dark ? Palette.border : '#E4DDD8',
    },
    secondaryText: { color: Palette.text, fontSize: 16, fontWeight: '600' },
    focused: { borderColor: Palette.accent },
    pressed: { opacity: 0.72 },
    form: {
      gap: 10,
      backgroundColor: Palette.card,
      borderRadius: 24,
      padding: 22,
      borderWidth: 1,
      borderColor: dark ? Palette.border : '#E6E8F0',
    },
    backButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingRight: 16 },
    backText: { color: Palette.accent, fontSize: 15, fontWeight: '600' },
    formTitle: { color: Palette.text, fontSize: 30, fontWeight: '600', letterSpacing: -0.8 },
    formSubtitle: { color: dark ? Palette.textSecondary : '#5C6578', fontSize: 15, marginBottom: 8 },
    label: { color: dark ? Palette.textSecondary : '#5C6578', fontSize: 13, fontWeight: '600', marginTop: 6 },
    input: {
      backgroundColor: dark ? Palette.bg : '#F7F4F2',
      borderWidth: 1,
      borderColor: Palette.border,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: Palette.text,
      fontSize: 16,
      minHeight: 48,
    },
    error: { color: Palette.red, marginTop: 4 },
    hint: { color: dark ? Palette.textSecondary : '#5C6578', fontSize: 12, textAlign: 'center', marginTop: 12 },
    link: { color: Palette.accent, textAlign: 'center', marginTop: 8, fontWeight: '600', paddingVertical: 12 },
  };
});
