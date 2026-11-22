#!/usr/bin/env node
// Publishes an over-the-air update for one EAS build profile:
//
//   bun run update:preview                     # message = latest commit subject
//   bun run update:preview -- "Fix chart tools"
//
// `eas update` does not read a build profile's "env" block, so without this the bundle would get
// whatever EXPO_PUBLIC_* values the local shell or .env holds (e.g. a LAN backend URL). This script
// takes the channel, EAS environment and env values from eas.json, so an update always matches the
// build it is delivered to.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const [profileName, ...messageParts] = process.argv.slice(2);
if (!profileName) {
  console.error('Usage: node scripts/eas-update.mjs <build-profile> [message]');
  process.exit(1);
}

const eas = JSON.parse(readFileSync(new URL('../eas.json', import.meta.url), 'utf8'));
const profile = eas.build?.[profileName];
if (!profile) {
  console.error(`eas.json has no build profile "${profileName}". Profiles: ${Object.keys(eas.build ?? {}).join(', ')}`);
  process.exit(1);
}
if (!profile.channel) {
  console.error(`Build profile "${profileName}" has no "channel", so its builds cannot receive updates.`);
  process.exit(1);
}

const git = (...args) => {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return ''; }
};
let message = messageParts.join(' ').trim();
if (!message) {
  message = git('log', '-1', '--format=%s') || 'Update';
  if (git('status', '--porcelain', '--', '.')) message += ' (with uncommitted changes)';
}

const env = { ...process.env, ...profile.env };
const args = ['eas-cli@latest', 'update', '--channel', profile.channel, '--message', message];
if (profile.environment) args.push('--environment', profile.environment);

console.log(`Publishing to channel "${profile.channel}" (${profileName}): ${message}`);
for (const [key, value] of Object.entries(profile.env ?? {})) {
  if (key.startsWith('EXPO_PUBLIC_')) console.log(`  ${key}=${value}`);
}
const result = spawnSync('bunx', args, { cwd: root, env, stdio: 'inherit' });
process.exit(result.status ?? 1);
