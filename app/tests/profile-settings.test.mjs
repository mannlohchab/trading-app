import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareProfileUpdate, validatePasswordChange } from '../src/lib/profileSettings.ts';

test('profile updates trim the name and send an empty bio to clear the saved bio', () => {
  assert.deepEqual(prepareProfileUpdate('  Anika  ', ''), { body: { displayName: 'Anika', bio: '' } });
});

test('profile updates reject blank names and values beyond API limits', () => {
  for (const [name, bio] of [['   ', ''], ['a'.repeat(65), ''], ['Anika', 'a'.repeat(281)]]) {
    assert.ok(prepareProfileUpdate(name, bio).error);
    assert.equal(prepareProfileUpdate(name, bio).body, undefined);
  }
  assert.ok(prepareProfileUpdate('a'.repeat(64), 'b'.repeat(280)).body);
});

test('password changes require a current password, valid length and matching confirmation', () => {
  for (const [current, next, confirm] of [
    ['', 'password', 'password'], ['old', 'short', 'short'],
    ['old', 'a'.repeat(129), 'a'.repeat(129)], ['old', 'password', 'different'],
  ]) assert.ok(validatePasswordChange(current, next, confirm));
});

test('password changes accept both length boundaries without trimming passwords', () => {
  assert.equal(validatePasswordChange('old', ' eight  ', ' eight  '), null);
  assert.equal(validatePasswordChange('old', 'a'.repeat(128), 'a'.repeat(128)), null);
});
