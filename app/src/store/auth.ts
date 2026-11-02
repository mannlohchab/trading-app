import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { create } from 'zustand';
import { DEMO_MODE } from '../lib/demoMode';
import { demoApi } from '../lib/demoData';

export type User = {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  theme: string;
  notifyPush: boolean;
  notifyEmail: boolean;
  privacyPublicProfile: boolean;
  createdAt: string;
};

type AuthState = {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  hydrated: boolean;
  setSession: (data: { user: User; accessToken: string; refreshToken: string }) => Promise<void>;
  clearSession: () => Promise<void>;
  hydrate: () => Promise<void>;
  updateUser: (user: User) => void;
};

const memoryStore = new Map<string, string>();

async function setItem(key: string, value: string) {
  if (Platform.OS === 'web') {
    memoryStore.set(key, value);
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore
    }
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string) {
  if (Platform.OS === 'web') {
    try {
      return localStorage.getItem(key) ?? memoryStore.get(key) ?? null;
    } catch {
      return memoryStore.get(key) ?? null;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function deleteItem(key: string) {
  if (Platform.OS === 'web') {
    memoryStore.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  hydrated: false,
  setSession: async ({ user, accessToken, refreshToken }) => {
    if (DEMO_MODE) { set({ user, accessToken, refreshToken }); return; }
    await setItem('accessToken', accessToken);
    await setItem('refreshToken', refreshToken);
    await setItem('user', JSON.stringify(user));
    set({ user, accessToken, refreshToken });
  },
  clearSession: async () => {
    if (DEMO_MODE) { set({ user: null, accessToken: null, refreshToken: null }); return; }
    await deleteItem('accessToken');
    await deleteItem('refreshToken');
    await deleteItem('user');
    set({ user: null, accessToken: null, refreshToken: null });
  },
  hydrate: async () => {
    if (DEMO_MODE) { set({ ...demoApi.session(), hydrated: true }); return; }
    const accessToken = await getItem('accessToken');
    const refreshToken = await getItem('refreshToken');
    const rawUser = await getItem('user');
    const user = rawUser ? (JSON.parse(rawUser) as User) : null;
    set({ accessToken, refreshToken, user, hydrated: true });
  },
  updateUser: (user) => {
    if (!DEMO_MODE) void setItem('user', JSON.stringify(user));
    set({ user });
  },
}));
