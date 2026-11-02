import { useState, type ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { GlassIcon, GlassPressable } from '@/components/ui/GlassIcon';
import { api } from '@/lib/api';
import { prepareProfileUpdate, validatePasswordChange } from '@/lib/profileSettings';
import type { User } from '@/store/auth';

type Props = {
  user: User;
  onUserSaved: (user: User) => void;
  onLogout: () => Promise<void>;
};

type Preference = 'notifyPush' | 'notifyEmail' | 'privacyPublicProfile';
type Feedback = { message: string; error?: boolean } | null;

export function ProfileSettings(props: Props) {
  return <SettingsForm key={props.user.id} {...props} />;
}

function SettingsForm({ user, onUserSaved, onLogout }: Props) {
  // An explicit empty string is a draft too: clearing a bio must reach the API.
  const [nameDraft, setNameDraft] = useState<string>();
  const [bioDraft, setBioDraft] = useState<string>();
  const displayName = nameDraft ?? user.displayName ?? user.username;
  const bio = bioDraft ?? user.bio ?? '';
  const [profileFeedback, setProfileFeedback] = useState<Feedback>(null);
  const [preferenceFeedback, setPreferenceFeedback] = useState<Feedback>(null);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const profileMutation = useMutation({
    mutationFn: (body: Partial<User>) => api<{ user: User }>('/api/users/me', { method: 'PATCH', body }),
    onSuccess: ({ user: savedUser }) => {
      onUserSaved(savedUser);
      setNameDraft(undefined);
      setBioDraft(undefined);
      setProfileFeedback({ message: 'Your profile has been saved.' });
    },
    onError: error => setProfileFeedback({ error: true, message: error.message || 'Could not save your profile. Please try again.' }),
  });
  const preferenceMutation = useMutation({
    mutationFn: ({ key, value }: { key: Preference; value: boolean }) =>
      api<{ user: User }>('/api/users/me', { method: 'PATCH', body: { [key]: value } }),
    onSuccess: ({ user: savedUser }) => {
      onUserSaved(savedUser);
      setPreferenceFeedback({ message: 'Preference saved.' });
    },
    onError: error => setPreferenceFeedback({ error: true, message: error.message || 'Could not save this preference. Please try again.' }),
  });
  const passwordMutation = useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api('/api/users/me/password', { method: 'POST', body }),
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
    const update = prepareProfileUpdate(displayName, bio);
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

  function setPreference(key: Preference, value: boolean) {
    if (busy) return;
    setPreferenceFeedback(null);
    preferenceMutation.mutate({ key, value });
  }

  function preferenceValue(key: Preference) {
    return preferenceMutation.isPending && preferenceMutation.variables.key === key
      ? preferenceMutation.variables.value : user[key];
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <CardHeading icon="profile" title="Your account" subtitle="A little more about you" />
        <View style={styles.accountDetails}>
          <Text style={styles.detailLabel}>USERNAME</Text>
          <Text selectable style={styles.detailValue}>@{user.username}</Text>
          <Text style={[styles.detailLabel, styles.emailLabel]}>EMAIL ADDRESS</Text>
          <Text selectable style={styles.detailValue}>{user.email}</Text>
        </View>
        <Field label="Display name" value={displayName} editable={!busy} maxLength={64}
          autoComplete="name" onChangeText={value => { setNameDraft(value); setProfileFeedback(null); }} />
        <Field label="Bio" value={bio} editable={!busy} maxLength={280} multiline
          placeholder="Share a little about yourself" onChangeText={value => { setBioDraft(value); setProfileFeedback(null); }} />
        <Text style={styles.counter}>{bio.length}/280 characters</Text>
        <Status feedback={profileFeedback} />
        <ActionButton title="Save profile" pendingTitle="Saving profile…" pending={profileMutation.isPending}
          disabled={busy} onPress={saveProfile} />
      </View>

      <View style={styles.card}>
        <CardHeading icon="send" title="Your preferences" subtitle="Stay connected on your terms" />
        <PreferenceRow title="Push notifications" description="Allow app notification updates" value={preferenceValue('notifyPush')}
          disabled={busy} onChange={value => setPreference('notifyPush', value)} />
        <PreferenceRow title="Email notifications" description="Allow updates to your inbox" value={preferenceValue('notifyEmail')}
          disabled={busy} onChange={value => setPreference('notifyEmail', value)} />
        <PreferenceRow title="Public profile" description="Let other members view your profile" value={preferenceValue('privacyPublicProfile')}
          disabled={busy} onChange={value => setPreference('privacyPublicProfile', value)} />
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
        {logoutMutation.isPending ? <ActivityIndicator color="#9d394c" /> : <GlassIcon name="send" rotation={180} size={23} />}
        <Text style={styles.logoutText}>{logoutMutation.isPending ? 'Logging out…' : 'Log out'}</Text>
      </GlassPressable>
      <Status feedback={logoutMutation.isError ? { error: true, message: logoutMutation.error.message || 'Could not log out. Please try again.' } : null} />
    </View>
  );
}

function CardHeading({ icon, title, subtitle }: { icon: ComponentProps<typeof GlassIcon>['name']; title: string; subtitle: string }) {
  return <View style={styles.heading}><View style={styles.iconTile}><GlassIcon name={icon} size={28} /></View>
    <View style={styles.flex}><Text accessibilityRole="header" style={styles.headingTitle}>{title}</Text><Text style={styles.subtitle}>{subtitle}</Text></View>
  </View>;
}

function Field({ label, ...props }: ComponentProps<typeof TextInput> & { label: string }) {
  return <View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput {...props}
    accessibilityLabel={label} placeholderTextColor="#758b9d" autoCapitalize={props.secureTextEntry ? 'none' : 'sentences'}
    autoCorrect={!props.secureTextEntry} style={[styles.input, props.multiline && styles.bio, !props.editable && styles.disabled]} /></View>;
}

function PreferenceRow({ title, description, value, disabled, onChange }: {
  title: string; description: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void;
}) {
  return <View style={styles.preferenceRow}><View style={styles.flex}><Text style={styles.preferenceTitle}>{title}</Text>
    <Text style={styles.preferenceDescription}>{description}</Text></View><Switch accessibilityLabel={title}
    accessibilityHint={description} disabled={disabled} value={value} onValueChange={onChange}
    trackColor={{ false: '#E4DFED', true: '#8370ED' }} thumbColor="#ffffff" ios_backgroundColor="#E4DFED" /></View>;
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
    {pending ? <ActivityIndicator color={secondary ? '#7657BA' : '#ffffff'} size="small" /> : null}
    <Text style={[styles.buttonText, secondary && styles.secondaryText]}>{pending ? pendingTitle : title}</Text>
  </GlassPressable>;
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 20, gap: 16 },
  card: { padding: 18, borderRadius: 22, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EAE5F2' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  iconTile: { width: 46, height: 46, borderRadius: 15, backgroundColor: '#F1ECFC', alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  headingTitle: { color: '#352C45', fontSize: 17, fontWeight: '600', letterSpacing: -0.3 },
  subtitle: { color: '#82758F', fontSize: 12, marginTop: 4, lineHeight: 17 },
  accountDetails: { padding: 14, backgroundColor: '#FAF8FE', borderRadius: 14, marginBottom: 10 },
  detailLabel: { fontSize: 10, letterSpacing: 1.4, fontWeight: '600', color: '#82758F' },
  detailValue: { color: '#514363', fontSize: 13, marginTop: 5, lineHeight: 19 },
  emailLabel: { marginTop: 14 },
  field: { marginTop: 12 },
  label: { fontSize: 12, color: '#514363', fontWeight: '500', marginBottom: 7 },
  input: { minHeight: 48, paddingHorizontal: 13, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E4DAF2', backgroundColor: '#FCFBFE', color: '#352C45', fontSize: 14 },
  bio: { minHeight: 96, textAlignVertical: 'top', lineHeight: 20 },
  counter: { color: '#93889F', textAlign: 'right', fontSize: 10, marginTop: 7 },
  helper: { color: '#82758F', fontSize: 11, marginTop: 8, lineHeight: 16 },
  preferenceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#EAE5F2' },
  preferenceTitle: { fontSize: 14, fontWeight: '500', color: '#514363' },
  preferenceDescription: { fontSize: 11, color: '#82758F', lineHeight: 16, marginTop: 4 },
  button: { minHeight: 48, marginTop: 16, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 13, backgroundColor: '#7657BA', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  buttonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  secondaryButton: { backgroundColor: '#F6F2FC', borderWidth: 1, borderColor: '#DFD5F4' },
  secondaryText: { color: '#7657BA' },
  feedback: { fontSize: 12, lineHeight: 18, marginTop: 10 },
  error: { color: '#a02f45' },
  success: { color: '#23704d' },
  logout: { minHeight: 52, backgroundColor: '#fff4f5', borderWidth: 1, borderColor: '#f0dce1', borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  logoutText: { color: '#9d394c', fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.75 },
});
