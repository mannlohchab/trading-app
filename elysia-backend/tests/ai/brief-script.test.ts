import { describe, expect, test } from 'bun:test';
import {
  estimateDurationSeconds,
  MORNING_DECODE_MAX_SECONDS,
  MORNING_DECODE_MAX_WORDS,
  trimToWordBudget,
} from '../../src/modules/ai/application/brief-script';

describe('morning decode script budget', () => {
  test('trims to the spoken word budget', () => {
    const words = Array.from({ length: MORNING_DECODE_MAX_WORDS + 40 }, (_, i) => `w${i}`).join(' ');
    const trimmed = trimToWordBudget(words);
    expect(trimmed.split(/\s+/).length).toBeLessThanOrEqual(MORNING_DECODE_MAX_WORDS + 1);
    expect(trimmed.endsWith('.')).toBe(true);
  });

  test('estimates duration under the four-minute cap', () => {
    const long = Array.from({ length: 900 }, () => 'word').join(' ');
    expect(estimateDurationSeconds(long)).toBe(MORNING_DECODE_MAX_SECONDS);
    expect(estimateDurationSeconds('short')).toBeGreaterThanOrEqual(30);
  });
});
