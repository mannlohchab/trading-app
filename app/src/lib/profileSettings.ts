export function prepareProfileUpdate(displayName: string, bio: string):
  { error: string; body?: never } | { error?: never; body: { displayName: string; bio: string } } {
  const name = displayName.trim();
  if (!name) return { error: 'Enter a display name.' };
  if (name.length > 64) return { error: 'Keep your display name to 64 characters or fewer.' };
  if (bio.length > 280) return { error: 'Keep your bio to 280 characters or fewer.' };
  return { body: { displayName: name, bio } };
}

export function validatePasswordChange(currentPassword: string, newPassword: string, confirmation: string): string | null {
  if (!currentPassword) return 'Enter your current password.';
  if (newPassword.length < 8 || newPassword.length > 128) return 'Use between 8 and 128 characters for your new password.';
  if (newPassword !== confirmation) return 'Your new passwords do not match.';
  return null;
}
