import { expoClient } from '@better-auth/expo/client';
import { phoneNumberClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { API_URL } from './config';

/**
 * Better Auth client for the backend's `/api/v1/auth`.
 * Native: the session cookie lives in SecureStore and is sent as a `Cookie` header (see `authHeaders`).
 * Web: the browser keeps the cookie, so requests use `credentials: 'include'`.
 */
export const authClient = createAuthClient({
  baseURL: `${API_URL}/api/v1/auth`,
  fetchOptions: Platform.OS === 'web' ? { credentials: 'include' } : undefined,
  plugins: [
    expoClient({ scheme: 'tradinggurukul', storagePrefix: 'tradinggurukul', storage: SecureStore }),
    phoneNumberClient(),
  ],
});

/** Headers and credentials that authenticate a plain `fetch`/`WebSocket` to the backend. */
export async function authHeaders(): Promise<{ headers: Record<string, string>; credentials: RequestCredentials }> {
  if (Platform.OS === 'web') return { headers: {}, credentials: 'include' };
  const cookie = await authClient.getCookie();
  return { headers: cookie ? { Cookie: cookie } : {}, credentials: 'omit' };
}
