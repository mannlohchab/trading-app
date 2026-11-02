import { Platform } from 'react-native';

/** API base URL — Android emulator uses 10.0.2.2 for host loopback */
function resolveApiUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  if (Platform.OS === 'android') return 'http://10.0.2.2:4000';
  return 'http://localhost:4000';
}

export const API_URL = resolveApiUrl();
