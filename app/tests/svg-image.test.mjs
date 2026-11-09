import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as svgImage from '../src/lib/svgImage.ts';

test('SVG source encoding preserves Unicode and every Base64 padding case', () => {
  for (const text of ['', 'a', 'ab', 'abc', '<svg>$103,565 · 投資</svg>']) {
    const source = svgImage.svgImageSource(text, 320, 320);
    assert.equal(source.uri.split(',')[1], Buffer.from(text, 'utf8').toString('base64'));
  }
});
