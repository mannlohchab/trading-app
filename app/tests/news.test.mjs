import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createDemoApi } from '../src/lib/demoData.ts';

function load(relativePath, modules) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  runInNewContext(outputText, { exports, URLSearchParams, require: name => {
    if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
    return modules[name];
  } });
  return exports;
}

test('fetchNews asks the backend for a page, with cursor and coin filter', async () => {
  const calls = [];
  const { fetchNews } = load('../src/lib/newsApi.ts', { './api': { api: async (path, options) => { calls.push([path, options]); return { articles: [], nextCursor: null }; } } });
  const signal = new AbortController().signal;
  await fetchNews({ limit: 4, signal });
  await fetchNews({ cursor: 'abc', asset: 'BTC' });
  assert.equal(calls[0][0], '/api/v1/news?limit=4');
  assert.equal(calls[0][1].signal, signal);
  assert.equal(calls[1][0], '/api/v1/news?limit=20&cursor=abc&asset=BTC');
});

test('only web links are openable', () => {
  const { isOpenable } = load('../src/lib/newsApi.ts', { './api': { api: async () => ({}) } });
  assert.equal(isOpenable({ url: 'https://coindesk.com/a' }), true);
  assert.equal(isOpenable({ url: 'javascript:alert(1)' }), false);
  assert.equal(isOpenable({ url: null }), false);
});

test('demo preview serves labelled sample news with no outside links', async () => {
  const demo = createDemoApi();
  const { articles, nextCursor } = await demo.request('/api/v1/news?limit=4');
  assert.ok(articles.length >= 4);
  assert.equal(nextCursor, null);
  for (const a of articles) {
    assert.match(a.title, /^Sample:/);
    assert.equal(a.url, null);
    assert.equal(a.imageUrl, null);
  }
  const btc = await demo.request('/api/v1/news?asset=btc');
  assert.ok(btc.articles.length > 0 && btc.articles.every(a => a.assets.includes('BTC')));
});
