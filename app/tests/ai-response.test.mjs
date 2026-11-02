import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseResponse, parseInline } from '../src/lib/aiResponse.ts';

test('responses expose headings, paragraphs and lists instead of raw markdown', () => {
  assert.deepEqual(parseResponse('## Market snapshot\n\nBitcoin is **higher**.\nWatch volume.\n\n- Price: 100 USDT\n- Risk: volatility\n\n1. Set a budget\n2. Review exposure'), [
    { type: 'heading', content: 'Market snapshot', level: 2 },
    { type: 'paragraph', content: 'Bitcoin is **higher**.\nWatch volume.' },
    { type: 'list', content: 'Price: 100 USDT', marker: '•', depth: 0 },
    { type: 'list', content: 'Risk: volatility', marker: '•', depth: 0 },
    { type: 'list', content: 'Set a budget', marker: '1.', depth: 0 },
    { type: 'list', content: 'Review exposure', marker: '2.', depth: 0 },
  ]);
});

test('inline emphasis preserves financial symbols and readable code', () => {
  assert.deepEqual(parseInline('**BTC** is *volatile*: `BTCUSDT` at $100.50.'), [
    { text: 'BTC', style: 'bold' }, { text: ' is ' }, { text: 'volatile', style: 'italic' },
    { text: ': ' }, { text: 'BTCUSDT', style: 'code' }, { text: ' at $100.50.' },
  ]);
});

test('partial streaming markers never discard the answer', () => {
  assert.deepEqual(parseInline('Price is **ris'), [{ text: 'Price is **ris' }]);
  assert.deepEqual(parseResponse('## Price\n\n**BTC'), [
    { type: 'heading', content: 'Price', level: 2 }, { type: 'paragraph', content: '**BTC' },
  ]);
  assert.deepEqual(parseResponse('```text\n**literal**'), [{ type: 'code', content: '**literal**' }]);
});

test('quotes and disclaimers are distinct blocks and HTML stays plain text', () => {
  assert.deepEqual(parseResponse('> Last observation\n\n---\n*Educational only.*\n\n<script>alert(1)</script>'), [
    { type: 'quote', content: 'Last observation' }, { type: 'divider', content: '' },
    { type: 'paragraph', content: '*Educational only.*' },
    { type: 'paragraph', content: '<script>alert(1)</script>' },
  ]);
});

test('nested bullets, CRLF, empty replies and fenced code preserve content', () => {
  assert.deepEqual(parseResponse(''), []);
  assert.deepEqual(parseResponse('- Main\r\n  - Nested\r\n\r\n```\r\n# not a heading\r\n```'), [
    { type: 'list', content: 'Main', marker: '•', depth: 0 },
    { type: 'list', content: 'Nested', marker: '•', depth: 1 },
    { type: 'code', content: '# not a heading' },
  ]);
});
