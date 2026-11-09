import { create } from 'zustand';
import { authClient, authHeaders } from '../lib/authClient';
import { API_URL } from '../lib/config';
import { DEMO_MODE } from '../lib/demoMode';
import { demoApi } from '../lib/demoData';

/** Account lifecycle on the backend: sign-up → phone OTP → ACTIVE. */
export type AccountStatus = 'PENDING_PHONE_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export type User = {
  id: string;
  email: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  status: AccountStatus;
  phoneNumber: string | null;
  timezone: string | null;
  createdAt: string;
};

type SessionUser = {
  id: string; email: string; name?: string | null; image?: string | null; status?: AccountStatus | null;
  phoneNumber?: string | null; createdAt: string | Date;
};
type Profile = { name: string | null; username: string | null; image: string | null; phoneNumber: string | null; timezone: string | null };

type AuthState = {
  user: User | null;
  hydrated: boolean;
  /** Re-reads the session (and, for active users, the profile) from the backend. */
  refresh: () => Promise<User | null>;
  hydrate: () => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (user: User) => void;
  /** Demo preview only. */
  setSession: (data: { user: User }) => Promise<void>;
  clearSession: () => Promise<void>;
};

/** Display name for greetings and avatars; never invents a handle. */
export function displayNameOf(user: Pick<User, 'displayName' | 'username' | 'email'>) {
  return user.displayName?.trim() || user.username || user.email.split('@')[0];
}

function fromSession(u: SessionUser): User {
  return {
    id: u.id, email: u.email, displayName: u.name?.trim() || null, username: null, avatarUrl: u.image ?? null,
    status: u.status ?? 'PENDING_PHONE_VERIFICATION', phoneNumber: u.phoneNumber ?? null, timezone: null,
    createdAt: new Date(u.createdAt).toISOString(),
  };
}

async function loadProfile(): Promise<Profile | null> {
  const { headers, credentials } = await authHeaders();
  const res = await fetch(`${API_URL}/api/v1/me/profile`, { headers, credentials });
  return res.ok ? (await res.json()) as Profile : null;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  hydrated: false,
  refresh: async () => {
    if (DEMO_MODE) return get().user;
    const { data, error } = await authClient.getSession();
    if (error || !data) {
      set({ user: null });
      return null;
    }
    let user = fromSession(data.user as unknown as SessionUser);
    if (user.status === 'ACTIVE') {
      const profile = await loadProfile().catch(() => null);
      if (profile) user = { ...user, displayName: profile.name?.trim() || user.displayName, username: profile.username,
        avatarUrl: profile.image ?? user.avatarUrl, phoneNumber: profile.phoneNumber, timezone: profile.timezone };
    }
    set({ user });
    return user;
  },
  hydrate: async () => {
    if (DEMO_MODE) { set({ user: demoApi.session().user as unknown as User, hydrated: true }); return; }
    try {
      await get().refresh();
    } catch {
      set({ user: null });
    } finally {
      set({ hydrated: true });
    }
  },
  signOut: async () => {
    if (!DEMO_MODE) await authClient.signOut().catch(() => undefined);
    set({ user: null });
  },
  updateUser: (user) => set({ user }),
  setSession: async ({ user }) => { set({ user }); },
  clearSession: async () => { set({ user: null }); },
}));
