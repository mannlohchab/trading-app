import { Platform } from 'react-native';

/** Hono backend (`backend/`). The Android emulator reaches the host loopback through 10.0.2.2. */
function resolveApiUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, '');
  if (Platform.OS === 'android') return 'http://10.0.2.2:4001';
  return 'http://localhost:4001';
}

export const API_URL = resolveApiUrl();
/** WebSocket origin of the same server. */
export const WS_URL = API_URL.replace(/^http/, 'ws');
