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

test('demo login, edits and logout never touch the real auth client', async () => {
  const unexpected = () => { throw new Error('Unexpected real auth call'); };
  const authClient = new Proxy({}, { get: () => unexpected });
  const demoApi = createDemoApi();
  const { useAuth } = load('../src/store/auth.ts', {
    zustand: require('zustand'), '../lib/authClient': { authClient, authHeaders: unexpected },
    '../lib/config': { API_URL: 'https://real.invalid' }, '../lib/demoMode': { DEMO_MODE: true }, '../lib/demoData': { demoApi },
  }, { fetch: unexpected });
  await useAuth.getState().hydrate();
  assert.equal(useAuth.getState().user.id, 'demo-preview-user');
  assert.equal(useAuth.getState().user.status, 'ACTIVE');
  assert.equal(useAuth.getState().hydrated, true);
  useAuth.getState().updateUser({ ...demoApi.session().user, displayName: 'Changed locally' });
  await useAuth.getState().signOut();
  assert.equal(useAuth.getState().user, null);
  await useAuth.getState().setSession(demoApi.session());
  assert.equal(useAuth.getState().user.id, 'demo-preview-user');
});

test('demo API, AI and quote subscriptions make no network or real-auth calls', async () => {
  const unexpected = () => { throw new Error('Unexpected real service call'); };
  const demoApi = createDemoApi();
  const { api, streamDemoAiChat } = load('../src/lib/api.ts', {
    'expo/fetch': { fetch: unexpected }, './aiChat': { consumeAiStream: unexpected }, './authClient': { authHeaders: unexpected },
    './config': { API_URL: 'https://real.invalid' }, './demoMode': { DEMO_MODE: true }, './demoData': { demoApi },
  }, { fetch: unexpected });
  assert.ok((await api('/api/watchlists')).watchlists.length);
  await assert.rejects(api('/api/unsupported'), /demo preview/);
  const events = [];
  await streamDemoAiChat({ message: 'Hello' }, event => events.push(event));
  assert.equal(events.at(-1).type, 'done');
  const { subscribeQuotes } = load('../src/lib/socket.ts', {
    'react-native': { Platform: { OS: 'android' } }, './authClient': { authHeaders: unexpected }, './config': { WS_URL: 'wss://real.invalid' },
    './demoMode': { DEMO_MODE: true }, './marketData': {}, './quoteSubscriptions': { QuoteSubscriptions },
  }, { WebSocket: unexpected });
  subscribeQuotes(['BINANCE:BTCUSDT'], unexpected)();
});

test('live mode uses the session cookie and never substitutes demo data on failure', async () => {
  const calls = [];
  const unexpected = () => { throw new Error('Demo data must stay disabled'); };
  const { api } = load('../src/lib/api.ts', {
    'expo/fetch': { fetch: unexpected }, './aiChat': {}, './config': { API_URL: 'https://real.invalid' },
    './authClient': { authHeaders: async () => ({ headers: { Cookie: 'better-auth.session_token=abc' }, credentials: 'omit' }) },
    './demoMode': { DEMO_MODE: false }, './demoData': { demoApi: { request: unexpected } },
  }, { fetch: async (url, options) => { calls.push({ url, options }); throw new Error('Market unavailable'); } });
  await assert.rejects(api('/api/v1/market/tickers'), /Market unavailable/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://real.invalid/api/v1/market/tickers');
  assert.equal(calls[0].options.headers.Cookie, 'better-auth.session_token=abc');
  assert.equal(calls[0].options.credentials, 'omit');
});

test('backend errors keep their message and code, and auth problems reach the handler', async () => {
  const problems = [];
  const responses = [
    { status: 403, body: { error: 'Verify your phone first.', code: 'PHONE_VERIFICATION_REQUIRED' } },
    { status: 400, body: { error: 'Invalid input.', code: 'VALIDATION_ERROR', fields: { quantity: 'Below the lot size.' } } },
    { status: 401, body: { message: 'Unauthorized' } },
  ];
  const { api, setAuthProblemHandler, ApiError } = load('../src/lib/api.ts', {
    'expo/fetch': { fetch: () => {} }, './aiChat': {}, './config': { API_URL: 'https://real.invalid' },
    './authClient': { authHeaders: async () => ({ headers: {}, credentials: 'include' }) },
    './demoMode': { DEMO_MODE: false }, './demoData': { demoApi: {} },
  }, { fetch: async () => { const r = responses.shift(); return { ok: false, status: r.status, statusText: '', json: async () => r.body }; } });
  setAuthProblemHandler(problem => problems.push(problem));
  const first = await api('/api/v1/paper/accounts').catch(e => e);
  assert.ok(first instanceof ApiError);
  assert.deepEqual([first.status, first.code, first.message], [403, 'PHONE_VERIFICATION_REQUIRED', 'Verify your phone first.']);
  const second = await api('/api/v1/paper/orders', { method: 'POST', body: {} }).catch(e => e);
  assert.deepEqual([second.code, second.message], ['VALIDATION_ERROR', 'Below the lot size.']);
  const third = await api('/api/v1/me/profile').catch(e => e);
  assert.equal(third.message, 'Unauthorized');
  assert.deepEqual(problems, ['phone-verification', 'signed-out']);
});
