import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../src/components/ai/MorningDecodeCard.tsx', import.meta.url), 'utf8');
const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'The embedded audio player has an executable script');

function player(currentTime, duration) {
  const audio = { currentTime, duration, paused: true };
  const messages = [];
  const window = { ReactNativeWebView: { postMessage: message => messages.push(JSON.parse(message)) } };
  runInNewContext(script, { window, document: { getElementById: () => audio } });
  return { audio, window, messages };
}

test('skipping moves the audio and reports its position without resuming paused playback', () => {
  const { audio, window, messages } = player(40, 180);
  assert.equal(typeof window.__tgSkip, 'function');
  window.__tgSkip(15);
  assert.equal(audio.currentTime, 55);
  assert.deepEqual(messages.at(-1), { type: 'time', t: 55, d: 180 });
  window.__tgSkip(-15);
  assert.equal(audio.currentTime, 40);
  assert.equal(audio.paused, true);
});

test('skipping stays within the beginning and end of the briefing', () => {
  const { audio, window } = player(5, 60);
  assert.equal(typeof window.__tgSkip, 'function');
  window.__tgSkip(-15);
  assert.equal(audio.currentTime, 0);
  audio.currentTime = 55;
  window.__tgSkip(15);
  assert.equal(audio.currentTime, 60);
});

test('skipping waits until a finite audio duration is available', () => {
  for (const duration of [NaN, Infinity, 0]) {
    const { audio, window, messages } = player(0, duration);
    assert.equal(typeof window.__tgSkip, 'function');
    window.__tgSkip(15);
    assert.equal(audio.currentTime, 0);
    assert.equal(messages.length, 0);
  }
});
