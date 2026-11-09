const USERNAME = /^[A-Za-z0-9_]{3,30}$/;

/** Body for PATCH /api/v1/me/profile. An empty username clears it (null). */
export function prepareProfileUpdate(displayName: string, username: string):
  { error: string; body?: never } | { error?: never; body: { name: string; username: string | null } } {
  const name = displayName.trim().replace(/\s+/g, ' ');
  if (!name) return { error: 'Enter a display name.' };
  if (name.length > 100) return { error: 'Keep your display name to 100 characters or fewer.' };
  const handle = username.trim().replace(/^@/, '');
  if (handle && !USERNAME.test(handle)) return { error: 'Usernames are 3 to 30 letters, numbers or underscores.' };
  return { body: { name, username: handle || null } };
}

export function validatePasswordChange(currentPassword: string, newPassword: string, confirmation: string): string | null {
  if (!currentPassword) return 'Enter your current password.';
  if (newPassword.length < 8 || newPassword.length > 128) return 'Use between 8 and 128 characters for your new password.';
  if (newPassword !== confirmation) return 'Your new passwords do not match.';
  return null;
}
