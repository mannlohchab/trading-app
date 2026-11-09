import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, Switch, View } from 'react-native';
import { Text, TextInput } from '@/components/ui/AppText';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GlassIcon, GlassPressable } from '@/components/ui/GlassIcon';
import { Palette } from '@/constants/theme';
import { api } from '@/lib/api';
import { authClient } from '@/lib/authClient';
import { DEMO_MODE } from '@/lib/demoMode';
import { prepareProfileUpdate, validatePasswordChange } from '@/lib/profileSettings';
import type { User } from '@/store/auth';

type Profile = { name: string | null; username: string | null; image: string | null; phoneNumber: string | null; timezone: string | null };
type Preferences = { general: { notificationsEnabled: boolean } };

type Props = {
  user: User;
  onUserSaved: (user: User) => void;
  onLogout: () => Promise<void>;
};

type Feedback = { message: string; error?: boolean } | null;

export function ProfileSettings(props: Props) {
  return <SettingsForm key={props.user.id} {...props} />;
}

function SettingsForm({ user, onUserSaved, onLogout }: Props) {
  // An explicit empty string is a draft too: clearing a username must reach the API.
  const [nameDraft, setNameDraft] = useState<string>();
  const [usernameDraft, setUsernameDraft] = useState<string>();
  const displayName = nameDraft ?? user.displayName ?? '';
  const username = usernameDraft ?? user.username ?? '';
  const qc = useQueryClient();
  const [profileFeedback, setProfileFeedback] = useState<Feedback>(null);
  const [preferenceFeedback, setPreferenceFeedback] = useState<Feedback>(null);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const profileMutation = useMutation({
    mutationFn: (body: { name: string; username: string | null }) => api<Profile>('/api/v1/me/profile', { method: 'PATCH', body }),
    onSuccess: profile => {
      onUserSaved({ ...user, displayName: profile.name, username: profile.username, avatarUrl: profile.image, timezone: profile.timezone });
      setNameDraft(undefined);
      setUsernameDraft(undefined);
      setProfileFeedback({ message: 'Your profile has been saved.' });
    },
    onError: error => setProfileFeedback({ error: true, message: error.message || 'Could not save your profile. Please try again.' }),
  });
  const preferences = useQuery({
    queryKey: ['preferences', user.id],
    enabled: !DEMO_MODE,
    queryFn: ({ signal }) => api<Preferences>('/api/v1/me/preferences', { signal }),
  });
  const preferenceMutation = useMutation({
    mutationFn: (notificationsEnabled: boolean) =>
      api<Preferences>('/api/v1/me/preferences', { method: 'PATCH', body: { general: { notificationsEnabled } } }),
    onSuccess: saved => {
      qc.setQueryData(['preferences', user.id], saved);
      setPreferenceFeedback({ message: 'Preference saved.' });
    },
    onError: error => setPreferenceFeedback({ error: true, message: error.message || 'Could not save this preference. Please try again.' }),
  });
  const passwordMutation = useMutation({
    mutationFn: async (body: { currentPassword: string; newPassword: string }) => {
      const { error } = await authClient.changePassword({ ...body, revokeOtherSessions: true });
      if (error) throw new Error(error.message || 'Could not change your password.');
    },
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmation('');
      setPasswordFeedback({ message: 'Your password has been changed.' });
    },
    onError: error => setPasswordFeedback({ error: true, message: error.message || 'Could not change your password. Please try again.' }),
  });
  const logoutMutation = useMutation({ mutationFn: onLogout });
  // Serialize account writes so a slower response cannot overwrite a newer user.
  const busy = profileMutation.isPending || preferenceMutation.isPending || passwordMutation.isPending || logoutMutation.isPending;

  function saveProfile() {
    if (busy) return;
    const update = prepareProfileUpdate(displayName, username);
    if (!update.body) {
      setProfileFeedback({ error: true, message: update.error });
      return;
    }
    setProfileFeedback(null);
    profileMutation.mutate(update.body);
  }

  function changePassword() {
    if (busy) return;
    const error = validatePasswordChange(currentPassword, newPassword, confirmation);
    if (error) {
      setPasswordFeedback({ error: true, message: error });
      return;
    }
    setPasswordFeedback(null);
    passwordMutation.mutate({ currentPassword, newPassword });
  }

  function setNotifications(value: boolean) {
    if (busy || !preferences.data) return;
    setPreferenceFeedback(null);
    preferenceMutation.mutate(value);
  }

  const notificationsEnabled = preferenceMutation.isPending ? preferenceMutation.variables : preferences.data?.general.notificationsEnabled ?? false;

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <CardHeading icon="profile" title="Your account" subtitle="A little more about you" />
        <View style={styles.accountDetails}>
          <Text style={styles.detailLabel}>EMAIL ADDRESS</Text>
          <Text selectable style={styles.detailValue}>{user.email}</Text>
          <Text style={[styles.detailLabel, styles.emailLabel]}>VERIFIED PHONE</Text>
          <Text selectable style={styles.detailValue}>{user.phoneNumber ?? '—'}</Text>
        </View>
        <Field label="Display name" value={displayName} editable={!busy} maxLength={100}
          autoComplete="name" onChangeText={value => { setNameDraft(value); setProfileFeedback(null); }} />
        <Field label="Username" value={username} editable={!busy} maxLength={31} autoCapitalize="none" autoCorrect={false}
          placeholder="Optional, e.g. trader_in" onChangeText={value => { setUsernameDraft(value); setProfileFeedback(null); }} />
        <Text style={styles.counter}>3–30 letters, numbers or underscores. Leave empty for none.</Text>
        <Status feedback={profileFeedback} />
        <ActionButton title="Save profile" pendingTitle="Saving profile…" pending={profileMutation.isPending}
          disabled={busy} onPress={saveProfile} />
      </View>

      <View style={styles.card}>
        <CardHeading icon="send" title="Your preferences" subtitle="Stay connected on your terms" />
        <PreferenceRow title="Notifications" description="Allow updates from TradingGurukul" value={notificationsEnabled}
          disabled={busy || !preferences.data} onChange={setNotifications} />
        {preferences.isError ? <Text style={styles.helper}>Could not load your preferences.</Text> : null}
        {preferenceMutation.isPending ? <Text style={styles.helper} accessibilityLiveRegion="polite">Saving preference…</Text> : null}
        <Status feedback={preferenceFeedback} />
      </View>

      <View style={styles.card}>
        <CardHeading icon="profile" title="Password & security" subtitle="Keep your account protected" />
        <Field label="Current password" value={currentPassword} editable={!busy} secureTextEntry
          autoComplete="current-password" onChangeText={value => { setCurrentPassword(value); setPasswordFeedback(null); }} />
        <Field label="New password" value={newPassword} editable={!busy} secureTextEntry maxLength={128}
          autoComplete="new-password" onChangeText={value => { setNewPassword(value); setPasswordFeedback(null); }} />
        <Text style={styles.helper}>Use 8–128 characters.</Text>
        <Field label="Confirm new password" value={confirmation} editable={!busy} secureTextEntry maxLength={128}
          autoComplete="new-password" onChangeText={value => { setConfirmation(value); setPasswordFeedback(null); }} />
        <Status feedback={passwordFeedback} />
        <ActionButton title="Change password" pendingTitle="Changing password…" pending={passwordMutation.isPending}
          disabled={busy} secondary onPress={changePassword} />
      </View>

      <GlassPressable accessibilityRole="button" accessibilityLabel="Log out" disabled={busy}
        accessibilityState={{ disabled: busy, busy: logoutMutation.isPending }}
        onPress={() => { if (!busy) logoutMutation.mutate(); }}
        style={({ pressed }) => [styles.logout, busy && styles.disabled, pressed && styles.pressed]}>
        {logoutMutation.isPending ? <ActivityIndicator color="#E11D48" /> : <GlassIcon name="send" rotation={180} size={23} tone="purple" />}
        <Text style={styles.logoutText}>{logoutMutation.isPending ? 'Logging out…' : 'Log out'}</Text>
      </GlassPressable>
      <Status feedback={logoutMutation.isError ? { error: true, message: logoutMutation.error.message || 'Could not log out. Please try again.' } : null} />
    </View>
  );
}

function CardHeading({ icon, title, subtitle }: { icon: ComponentProps<typeof GlassIcon>['name']; title: string; subtitle: string }) {
  return <View style={styles.heading}><View style={styles.iconTile}><GlassIcon name={icon} size={28} tone="purple" /></View>
    <View style={styles.flex}><Text accessibilityRole="header" style={styles.headingTitle}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text></View>
  </View>;
}

function Field({ label, ...props }: ComponentProps<typeof TextInput> & { label: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput {...props}
    accessibilityLabel={label} placeholderTextColor={Palette.textMuted} autoCapitalize={props.autoCapitalize ?? (props.secureTextEntry ? 'none' : 'sentences')}
    autoCorrect={props.autoCorrect ?? !props.secureTextEntry} style={[styles.input, props.multiline && styles.bio, !props.editable && styles.disabled]} /></View>;
}

function PreferenceRow({ title, description, value, disabled, onChange }: {
  title: string; description: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void;
}) {
  return <View style={styles.preferenceRow}><View style={styles.flex}><Text style={styles.preferenceTitle}>{title}</Text>
    <Text style={styles.preferenceDescription}>{description}</Text></View><Switch accessibilityLabel={title}
    accessibilityHint={description} disabled={disabled} value={value} onValueChange={onChange}
    trackColor={{ false: Palette.border, true: Palette.accent }} thumbColor="#ffffff" ios_backgroundColor={Palette.border} /></View>;
}

function Status({ feedback }: { feedback: Feedback }) {
  return feedback ? <Text accessibilityRole={feedback.error ? 'alert' : undefined} accessibilityLiveRegion="polite"
    style={[styles.feedback, feedback.error ? styles.error : styles.success]}>{feedback.message}</Text> : null;
}

function ActionButton({ title, pendingTitle, pending, disabled, secondary, onPress }: {
  title: string; pendingTitle: string; pending: boolean; disabled: boolean; secondary?: boolean; onPress: () => void;
}) {
  return <GlassPressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled, busy: pending }}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.button, secondary && styles.secondaryButton,
      disabled && styles.disabled, pressed && styles.pressed]}>
    {pending ? <ActivityIndicator color={secondary ? '#0066FF' : '#ffffff'} size="small" /> : null}
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{pending ? pendingTitle : title}</Text>
  </GlassPressable>;
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 16 },
  card: { padding: 18, borderRadius: 22, backgroundColor: Palette.card, borderWidth: 1, borderColor: Palette.border },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  iconTile: { width: 46, height: 46, borderRadius: 15, backgroundColor: '#F3EEFF', alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  headingTitle: { color: Palette.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.3 },
  subtitle: { color: Palette.textSecondary, fontSize: 12, marginTop: 4, lineHeight: 17 },
  accountDetails: { padding: 14, backgroundColor: Palette.bg, borderRadius: 14, marginBottom: 10 },
  detailLabel: { fontSize: 10, letterSpacing: 1.4, fontWeight: '600', color: Palette.textSecondary },
  detailValue: { color: Palette.text, fontSize: 13, marginTop: 5, lineHeight: 19 },
  emailLabel: { marginTop: 14 },
  field: { marginTop: 12 },
  label: { fontSize: 12, color: Palette.textSecondary, fontWeight: '500', marginBottom: 7 },
  input: { minHeight: 48, paddingHorizontal: 13, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: Palette.border, backgroundColor: Palette.bg, color: Palette.text, fontSize: 14 },
  bio: { minHeight: 96, textAlignVertical: 'top', lineHeight: 20 },
  counter: { color: Palette.textMuted, textAlign: 'right', fontSize: 10, marginTop: 7 },
  helper: { color: Palette.textSecondary, fontSize: 11, marginTop: 8, lineHeight: 16 },
  preferenceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Palette.border },
  preferenceTitle: { fontSize: 14, fontWeight: '500', color: Palette.text },
  preferenceDescription: { fontSize: 11, color: Palette.textSecondary, lineHeight: 16, marginTop: 4 },
  button: { minHeight: 48, marginTop: 16, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 13, backgroundColor: Palette.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  buttonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  secondaryButton: { backgroundColor: Palette.accentMuted, borderWidth: 1, borderColor: '#0066FF' },
  secondaryText: { color: '#0052D6' },
  feedback: { fontSize: 12, lineHeight: 18, marginTop: 10 },
  error: { color: '#E11D48' },
  success: { color: '#059669' },
  logout: { minHeight: 52, backgroundColor: 'rgba(244,63,94,0.12)', borderWidth: 1, borderColor: 'rgba(244,63,94,0.35)', borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  logoutText: { color: '#E11D48', fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.75 },
});
