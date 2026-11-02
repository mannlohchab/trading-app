import { Image } from 'expo-image';
import { Link, router, useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { useCallback, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api, ApiError } from '@/lib/api';
import { SwipeButton, type SwipeButtonHandle } from '@/components/ui/SwipeButton';
import { useAuth, type User } from '@/store/auth';

function LoginButtonGradient() {
  const progress = useSharedValue(0);
  const width = useSharedValue(0);

  useFocusEffect(useCallback(() => {
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: 3200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
      undefined,
      ReduceMotion.System,
    );
    return () => cancelAnimation(progress);
  }, [progress]));

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (progress.value - 0.5) * width.value * 1.5 }],
  }));

  return (
    <View
      pointerEvents="none"
      accessible={false}
      style={StyleSheet.absoluteFill}
      onLayout={(event) => { width.value = event.nativeEvent.layout.width; }}>
      <Animated.View style={[styles.loginGradient, animatedStyle]}>
        <Image
          source={require('@/assets/images/login-button-gradient.svg')}
          style={StyleSheet.absoluteFill}
          contentFit="fill"
          accessible={false}
        />
      </Animated.View>
    </View>
  );
}

export default function LoginScreen() {
  const setSession = useAuth((s) => s.setSession);
  const [showLogin, setShowLogin] = useState(false);
  const [emailOrUsername, setEmailOrUsername] = useState('demo');
  const [password, setPassword] = useState('password123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const swipeButton = useRef<SwipeButtonHandle>(null);
  const onSignInSuccess = useCallback(() => router.replace('/(tabs)/markets'), []);

  useFocusEffect(useCallback(() => {
    setStatusBarStyle('light');
    return () => setStatusBarStyle('dark');
  }, []));

  async function onSubmit() {
    if (submitting.current) return false;
    submitting.current = true;
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ user: User; accessToken: string; refreshToken: string }>(
        '/api/auth/login',
        { method: 'POST', body: { emailOrUsername, password }, auth: false },
      );
      await setSession(data);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Login failed');
      return false;
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <View style={styles.screen}>
      <Image
        source={require('@/assets/images/login-curtain.svg')}
        style={StyleSheet.absoluteFill}
        contentFit="fill"
        accessible={false}
        pointerEvents="none"
      />
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
                  style={styles.backButton}>
                  <Text style={styles.backText}>← Back</Text>
                </Pressable>
                <Text style={styles.formTitle}>Welcome back</Text>
                <Text style={styles.formSubtitle}>Log in to TradingGurukul</Text>
                <Text style={styles.label}>Email or username</Text>
                <TextInput
                  accessibilityLabel="Email or username"
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={emailOrUsername}
                  onChangeText={setEmailOrUsername}
                  placeholderTextColor="#b8b5d1"
                  autoComplete="username"
                  placeholder="demo"
                />
                <Text style={styles.label}>Password</Text>
                <TextInput
                  accessibilityLabel="Password"
                  style={styles.input}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  placeholderTextColor="#b8b5d1"
                  autoComplete="current-password"
                  returnKeyType="go"
                  onSubmitEditing={() => { void swipeButton.current?.submit(); }}
                  placeholder="••••••••"
                />
                {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
                <SwipeButton ref={swipeButton} loading={loading} onSwipeComplete={onSubmit} onSuccess={onSignInSuccess} />
                <Text style={styles.hint}>Demo: demo / password123</Text>
                <Link href="/(auth)/register" style={styles.link}>
                  Create an account
                </Link>
              </View>
            ) : (
              <View style={styles.welcome}>
                <View style={styles.headline}>
                  <Text accessibilityRole="header" style={styles.title}>Invest Smarter</Text>
                  <Text style={styles.subtitle}>Not Harder</Text>
                </View>
                <Text style={styles.description}>
                  Practice trading forex and crypto with{'\n'}real-time insights at your fingertips
                </Text>
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.button, styles.welcomeButton, styles.loginButton, pressed && styles.buttonPressed]}
                    onPress={() => setShowLogin(true)}>
                    <LoginButtonGradient />
                    <Text style={[styles.buttonText, styles.loginButtonText]}>Log in</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.button, styles.welcomeButton, pressed && styles.buttonPressed]}
                    onPress={() => router.push('/(auth)/register')}>
                    <Text style={styles.buttonText}>Register</Text>
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#191a18' },
  safe: { flex: 1 },
  wrap: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 18, paddingTop: 32, paddingBottom: 28, maxWidth: 460, width: '100%', alignSelf: 'center' },
  loginWrap: { justifyContent: 'center' },
  welcome: { paddingTop: 32 },
  headline: { alignItems: 'center' },
  title: { color: '#fff', fontSize: 42, fontWeight: '700', letterSpacing: -1.8, textAlign: 'center' },
  subtitle: { color: '#fff', fontSize: 28, fontWeight: '400', letterSpacing: -0.8, textAlign: 'center' },
  description: { color: '#fff', fontSize: 14, lineHeight: 18, textAlign: 'center', marginTop: 14, marginBottom: 40 },
  actions: { flexDirection: 'row', gap: 14 },
  welcomeButton: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0, height: 48 },
  loginButton: { overflow: 'hidden', backgroundColor: '#fff', borderColor: '#fff' },
  loginButtonText: { color: '#171321', fontWeight: '500' },
  loginGradient: { position: 'absolute', top: 0, bottom: 0, left: '-100%', width: '300%' },
  form: { gap: 10, backgroundColor: 'rgba(21, 19, 42, 0.86)', borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.18)', padding: 24 },
  backButton: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingRight: 16 },
  backText: { color: '#efedff', fontSize: 14 },
  formTitle: { color: '#fff', fontSize: 30, fontWeight: '700', letterSpacing: -0.8 },
  formSubtitle: { color: '#d8d4ef', fontSize: 14, marginBottom: 16 },
  label: { color: '#efedff', fontSize: 12, fontWeight: '600', marginTop: 8 },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.24)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 16,
  },
  button: {
    backgroundColor: '#faf9ff',
    borderColor: '#fff',
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonPressed: { opacity: 0.75 },
  buttonText: { color: '#171321', fontWeight: '500', fontSize: 14 },
  error: { color: '#ffbdc8', marginTop: 8 },
  hint: { color: '#d8d4ef', fontSize: 12, textAlign: 'center', marginTop: 12 },
  link: { color: '#fff', textAlign: 'center', marginTop: 16, fontWeight: '600', paddingVertical: 12 },
});
