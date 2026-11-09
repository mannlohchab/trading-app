import { Redirect } from 'expo-router';

import { useAuth } from '@/store/auth';

export default function Index() {
  const user = useAuth((s) => s.user);
  if (!user) return <Redirect href="/(auth)/login" />;
  if (user.status !== 'ACTIVE') return <Redirect href="/(auth)/verify-phone" />;
  return <Redirect href="/(tabs)/markets" />;
}
