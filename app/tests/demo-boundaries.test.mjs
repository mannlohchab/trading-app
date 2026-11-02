import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { QuoteSubscriptions } from '../src/lib/quoteSubscriptions.ts';
import { createDemoApi } from '../src/lib/demoData.ts';

const require = createRequire(import.meta.url);
// Execute the real boundary modules with native services replaced by test doubles.
function load(relativePath, modules, globals = {}) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  runInNewContext(outputText, { exports, require: name => {
    if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
    return modules[name];
  }, ...globals });
  return exports;
}

test('demo login, edits and logout never read or overwrite a saved real session', async () => {
  for (const platform of ['web', 'android']) {
    const storageCalls = [];
    const storage = {
      getItem: key => { storageCalls.push(['read', key]); return 'real-session'; },
      setItem: (key, value) => storageCalls.push(['write', key, value]),
      removeItem: key => storageCalls.push(['delete', key]),
    };
    const demoApi = createDemoApi();
    const { useAuth } = load('../src/store/auth.ts', {
      'expo-secure-store': { getItemAsync: storage.getItem, setItemAsync: storage.setItem, deleteItemAsync: storage.removeItem },
      'react-native': { Platform: { OS: platform } }, zustand: require('zustand'),
      '../lib/demoMode': { DEMO_MODE: true }, '../lib/demoData': { demoApi },
    }, { localStorage: storage });
    await useAuth.getState().hydrate();
    assert.equal(useAuth.getState().user.id, 'demo-preview-user');
    assert.equal(useAuth.getState().hydrated, true);
    useAuth.getState().updateUser({ ...demoApi.session().user, displayName: 'Changed locally' });
    await useAuth.getState().clearSession();
    assert.equal(useAuth.getState().user, null);
    await useAuth.getState().setSession(demoApi.session());
    assert.equal(useAuth.getState().user.id, 'demo-preview-user');
    assert.deepEqual(storageCalls, []);
  }
});

test('demo API, AI and quote subscriptions make no network or real-auth calls', async () => {
  const unexpected = () => { throw new Error('Unexpected real service call'); };
  const demoApi = createDemoApi();
  const { api, streamAiChat } = load('../src/lib/api.ts', {
    'expo/fetch': { fetch: unexpected }, './aiChat': { consumeAiStream: unexpected },
    './config': { API_URL: 'https://real.invalid' }, './demoMode': { DEMO_MODE: true }, './demoData': { demoApi },
    '@/store/auth': { useAuth: { getState: unexpected } },
  }, { fetch: unexpected });
  assert.ok((await api('/api/watchlists')).watchlists.length);
  await assert.rejects(api('/api/unsupported'), /demo preview/);
  const events = [];
  await streamAiChat({ message: 'Hello' }, event => events.push(event));
  assert.equal(events.at(-1).type, 'done');
  const { subscribeQuotes } = load('../src/lib/socket.ts', {
    './quoteSubscriptions': { QuoteSubscriptions }, 'socket.io-client': { io: unexpected }, './config': { API_URL: 'https://real.invalid' }, './demoMode': { DEMO_MODE: true },
  });
  subscribeQuotes(['NIFTY'], unexpected)();
});

test('live mode still uses the network and never substitutes demo data on failure', async () => {
  const calls = [];
  const unexpected = () => { throw new Error('Demo data must stay disabled'); };
  const { api } = load('../src/lib/api.ts', {
    'expo/fetch': { fetch: unexpected }, './aiChat': {}, './config': { API_URL: 'https://real.invalid' },
    './demoMode': { DEMO_MODE: false }, './demoData': { demoApi: { request: unexpected } },
    '@/store/auth': { useAuth: { getState: () => ({ accessToken: 'real-access' }) } },
  }, { fetch: async (url, options) => { calls.push({ url, options }); throw new Error('Market unavailable'); } });
  await assert.rejects(api('/api/market/explore'), /Market unavailable/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer real-access');
});
