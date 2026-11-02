import { Redirect } from 'expo-router';

import { useAuth } from '@/store/auth';

export default function Index() {
  const user = useAuth((s) => s.user);
  if (user) return <Redirect href="/(tabs)/markets" />;
  return <Redirect href="/(auth)/login" />;
}
