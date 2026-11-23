import { describe, expect, test } from 'bun:test';
import {
  checkBody, cleanText, decodeCursor, decodeImageDataUrl, displayName, encodeCursor, normalizeTicker, parseReportReason, safeImageUrl, sniffImageType,
} from '../../src/modules/community/domain/rules';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

describe('text', () => {
  test('cleans control characters, bidi overrides and blank-line runs', () => {
    expect(cleanText('  BTC‮ looks\r\nstrong \n\n\n\nhere\u0000 ')).toBe('BTC looks\nstrong\n\nhere');
  });
  test('rejects empty and over-long bodies', () => {
    expect(checkBody(' \n ', 10, 'Post')).toEqual({ ok: false, message: "Post can't be empty." });
    expect(checkBody('x'.repeat(11), 10, 'Post').ok).toBe(false);
    // Code points, not UTF-16 units: ten emoji fit in ten characters.
    expect(checkBody('📈'.repeat(10), 10, 'Post')).toEqual({ ok: true, text: '📈'.repeat(10) });
  });
});

test('tickers accept common spellings', () => {
  expect(normalizeTicker(' btc/usdt ')).toBe('BTCUSDT');
  expect(normalizeTicker('eth-btc')).toBe('ETHBTC');
  expect(normalizeTicker('$$$')).toBeNull();
});

describe('images', () => {
  test('sniffs the real format', () => {
    expect(sniffImageType(new Uint8Array(PNG))).toBe('image/png');
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
  test('decodes data URLs and refuses disguised files', () => {
    const ok = decodeImageDataUrl(`data:image/jpeg;base64,${PNG.toString('base64')}`);
    expect(ok.ok && ok.contentType).toBe('image/png');
    expect(decodeImageDataUrl(`data:image/png;base64,${Buffer.from('<svg/>').toString('base64')}`).ok).toBe(false);
    expect(decodeImageDataUrl('https://example.com/a.png').ok).toBe(false);
    expect(decodeImageDataUrl(`data:image/png;base64,${Buffer.alloc(1_600_000, 1).toString('base64')}`)).toEqual({ ok: false, message: 'Images must be under 1.5 MB.' });
  });
});

test('report reasons accept codes and app labels', () => {
  expect(parseReportReason('Misleading content')).toEqual({ reason: 'MISLEADING', details: null });
  expect(parseReportReason('spam')).toEqual({ reason: 'SPAM', details: null });
  expect(parseReportReason('Pump and dump scheme')).toEqual({ reason: 'OTHER', details: 'Pump and dump scheme' });
});

test('authors get a readable name and only web avatars', () => {
  expect(displayName({ firstName: 'Asha', lastName: 'Rao', name: 'x', username: 'u' })).toBe('Asha Rao');
  expect(displayName({ firstName: null, lastName: null, name: null, username: null })).toBe('Trader');
  expect(safeImageUrl('javascript:alert(1)')).toBeNull();
  expect(safeImageUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
});

test('cursors round-trip and reject garbage', () => {
  const id = '3f2b8c1e-1d2a-4b5c-8d9e-0a1b2c3d4e5f';
  expect(decodeCursor(encodeCursor({ atMicros: '1794251464218123', id }))).toEqual({ atMicros: '1794251464218123', id });
  expect(decodeCursor('not-a-cursor')).toBeNull();
});
