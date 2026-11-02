import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import * as allocation from '../src/lib/portfolioAllocation.ts';
import * as format from '../src/lib/format.ts';
import * as svgImage from '../src/lib/svgImage.ts';

function renderDonut(portfolio) {
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const source = readFileSync(new URL('../src/components/charts/PortfolioDonut.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: { useState: initial => [initial, () => {}], useMemo: factory => factory() },
    'expo-image': { Image: 'Image' },
    'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: styles => styles, absoluteFill: {} } },
    '@/components/ui/GlassIcon': { GlassPressable: 'Pressable' },
    '@/lib/portfolioAllocation': allocation,
    '@/lib/format': format,
    '@/lib/svgImage': svgImage,
  };
  runInNewContext(code, { exports, require: name => { assert.ok(modules[name], name); return modules[name]; } });
  const tree = exports.PortfolioDonut({ portfolio });
  const findImage = node => {
    if (!node || typeof node !== 'object') return null;
    if (node.type === 'Image') return node;
    return [node.props?.children].flat(Infinity).map(findImage).find(Boolean);
  };
  return findImage(tree).props.source;
}

test('portfolio ring uses a Base64 SVG source accepted by the Android image loader', () => {
  const source = renderDonut({ equity: 1035655, cashBalance: 348595, positions: [{ marketValue: 687060 }] });
  assert.match(source.uri, /^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(source.uri.split(',')[1], 'base64').toString('utf8');
  assert.match(svg, /^<svg /);
  assert.match(svg, /stroke="#DC4C64"/);
  assert.match(svg, /stroke="#169B70"/);
  assert.match(svg, />66\.3%<\/text>/);
  assert.match(svg, />33\.7%<\/text>/);
  assert.ok(svg.endsWith('</svg>'));
  assert.equal(source.width, 320);
  assert.equal(source.height, 320);
});

test('SVG source encoding preserves Unicode and every Base64 padding case', () => {
  for (const text of ['', 'a', 'ab', 'abc', '<svg>₹10,35,655 · 投資</svg>']) {
    const source = svgImage.svgImageSource(text, 320, 320);
    assert.equal(source.uri.split(',')[1], Buffer.from(text, 'utf8').toString('base64'));
  }
});

test('empty and unavailable portfolios still provide a decodable neutral ring', () => {
  for (const portfolio of [undefined, { equity: 0, cashBalance: 0, positions: [] }]) {
    const source = renderDonut(portfolio);
    assert.match(source.uri, /^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(source.uri.split(',')[1], 'base64').toString('utf8');
    assert.match(svg, /stroke="#F0F1F5"/);
    assert.doesNotMatch(svg, /NaN|Infinity/);
  }
});
