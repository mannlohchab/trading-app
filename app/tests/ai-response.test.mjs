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

test('markdown tables become table blocks, even mid-stream', async () => {
  const { cellTone, isNumericCell } = await import('../src/lib/aiResponse.ts');
  const text = '**Winners vs. losers**\n| Asset | P/L (USDT) | % change |\n|------|-----:|:---:|\n| **BTC** | +1 902 | **+6.3 %** |\n| ETH | –270 | -7 %\n\nAfter the table.';
  assert.deepEqual(parseResponse(text), [
    { type: 'paragraph', content: '**Winners vs. losers**' },
    { type: 'table', content: '', header: ['Asset', 'P/L (USDT)', '% change'], align: [null, 'right', 'center'],
      rows: [['**BTC**', '+1 902', '**+6.3 %**'], ['ETH', '–270', '-7 %']] },
    { type: 'paragraph', content: 'After the table.' },
  ]);
  // Before the separator row arrives, the header is plain text.
  assert.deepEqual(parseResponse('| Asset | P/L |'), [{ type: 'paragraph', content: '| Asset | P/L |' }]);
  // Short rows are padded to the header's width.
  assert.deepEqual(parseResponse('| A | B |\n|---|---|\n| x |')[0].rows, [['x', '']]);

  assert.equal(cellTone('+1 902'), 'up');
  assert.equal(cellTone('**-7 %**'), 'down');
  assert.equal(cellTone('–270'), 'down');
  assert.equal(cellTone('+0 %'), undefined);
  assert.equal(cellTone('84.9 %'), undefined);
  assert.equal(cellTone('Small win'), undefined);
  assert.equal(isNumericCell('84.9 %'), true);
  assert.equal(isNumericCell('₹2,900.50'), true);
  assert.equal(isNumericCell('678 days'), true);
  assert.equal(isNumericCell('Break-even.'), false);
});
