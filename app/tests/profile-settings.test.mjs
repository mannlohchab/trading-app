import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareProfileUpdate, validatePasswordChange } from '../src/lib/profileSettings.ts';

test('profile updates trim the name and send an empty username as null to clear it', () => {
  assert.deepEqual(prepareProfileUpdate('  Anika   Rao ', ''), { body: { name: 'Anika Rao', username: null } });
  assert.deepEqual(prepareProfileUpdate('Anika', ' @anika_r '), { body: { name: 'Anika', username: 'anika_r' } });
});

test('profile updates reject blank names and values the backend would refuse', () => {
  for (const [name, username] of [['   ', ''], ['a'.repeat(101), ''], ['Anika', 'ab'], ['Anika', 'has space'], ['Anika', 'a'.repeat(31)]]) {
    assert.ok(prepareProfileUpdate(name, username).error);
    assert.equal(prepareProfileUpdate(name, username).body, undefined);
  }
  assert.ok(prepareProfileUpdate('a'.repeat(100), 'b'.repeat(30)).body);
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
