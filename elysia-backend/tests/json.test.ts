import { expect, test } from 'bun:test';
import { parseJsonLossless } from '../src/db/json';

test('numbers that would lose digits are kept as their exact text', () => {
  expect(parseJsonLossless('[123456789012345678.123456789012, 0.500000000000, 9007199254740993]'))
    .toEqual(['123456789012345678.123456789012', '0.500000000000', '9007199254740993']);
});

test('round-trippable numbers and other values are unchanged', () => {
  expect(parseJsonLossless('{"a":7,"b":0.5,"c":-12,"d":true,"e":null,"f":"1.0","g":[1731100000000]}'))
    .toEqual({ a: 7, b: 0.5, c: -12, d: true, e: null, f: '1.0', g: [1731100000000] });
});
