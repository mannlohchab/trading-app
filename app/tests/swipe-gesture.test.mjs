import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getSwipeOffset, isSwipeComplete } from '../src/components/ui/swipe-gesture.ts';

test('a tap or partial swipe does not submit', () => {
  assert.equal(isSwipeComplete(0, 200), false);
  assert.equal(isSwipeComplete(100, 200), false);
  assert.equal(isSwipeComplete(179, 200), false);
});

test('reaching the end zone submits, including overshooting the track', () => {
  assert.equal(isSwipeComplete(180, 200), true);
  assert.equal(isSwipeComplete(300, 200), true);
  assert.equal(isSwipeComplete(90, 100), true);
});

test('an unmeasured or collapsed track cannot submit', () => {
  assert.equal(isSwipeComplete(0, 0), false);
  assert.equal(isSwipeComplete(100, -10), false);
});

test('dragging left or past the end keeps the handle inside the track', () => {
  assert.equal(getSwipeOffset(-30, 200), 0);
  assert.equal(getSwipeOffset(300, 200), 200);
  assert.equal(getSwipeOffset(75, 200), 75);
  assert.equal(getSwipeOffset(75, 0), 0);
});

test('invalid gesture measurements cannot submit or move the handle', () => {
  assert.equal(isSwipeComplete(NaN, 200), false);
  assert.equal(isSwipeComplete(Infinity, 200), false);
  assert.equal(isSwipeComplete(200, Infinity), false);
  assert.equal(getSwipeOffset(NaN, 200), 0);
});
