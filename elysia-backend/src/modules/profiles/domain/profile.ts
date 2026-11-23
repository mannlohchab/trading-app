// Profile rules. Pure functions: no framework, database or I/O.
import { isValidTimeZone, type FieldErrors, type Validated } from './validation';

export type Profile = {
  id: string;
  name: string | null;
  username: string | null;
  image: string | null;
  email: string | null;
  phoneNumber: string | null;
  timezone: string;
};

export type ProfileChanges = {
  name?: string;
  /** null removes the username. */
  username?: string | null;
  /** null removes the picture. */
  image?: string | null;
  timezone?: string;
};

const USERNAME = /^[A-Za-z0-9_]{3,30}$/;
const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'support', 'help', 'root', 'system', 'tradinggurukul', 'official', 'moderator', 'staff']);

export function validateProfileChanges(input: ProfileChanges): Validated<ProfileChanges> {
  const errors: FieldErrors = {};
  const value: ProfileChanges = {};

  if (input.name !== undefined) {
    const name = input.name.trim().replace(/\s+/g, ' ');
    if (name.length < 1 || name.length > 100) errors.name = 'Name must be 1 to 100 characters.';
    else value.name = name;
  }
  if (input.username !== undefined) {
    if (input.username === null) value.username = null;
    else if (!USERNAME.test(input.username)) errors.username = 'Username must be 3 to 30 letters, numbers or underscores.';
    else if (RESERVED_USERNAMES.has(input.username.toLowerCase())) errors.username = 'That username is reserved.';
    else value.username = input.username;
  }
  if (input.image !== undefined) {
    if (input.image === null) value.image = null;
    else if (!isHttpsUrl(input.image)) errors.image = 'Profile picture must be an https URL of at most 2048 characters.';
    else value.image = input.image;
  }
  if (input.timezone !== undefined) {
    if (!isValidTimeZone(input.timezone)) errors.timezone = 'Unknown time zone. Use an IANA name such as Asia/Kolkata.';
    else value.timezone = input.timezone;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

function isHttpsUrl(value: string): boolean {
  if (value.length > 2048) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}
