import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer, marketRoute } from '../server.mjs';
const id = 'A'.repeat(32);
const fakeKey = 'test-secret-for-unit-tests-only';
async function local(t, options = {}) {
  const server = createServer(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}
test('only documented read routes, limits and query fields are accepted', () => {
  assert.equal(marketRoute(new URL('http://local/api/markets?status=secondary&cursor=opaque%2Bcursor&limit=50')), '/markets/?status=secondary&cursor=opaque%2Bcursor&limit=50');
  assert.equal(marketRoute(new URL(`http://local/api/markets/${id}`)), `/markets/${id}/`);
  assert.equal(marketRoute(new URL(`http://local/api/markets/${id}/trades?limit=200`)), `/markets/${id}/trades/?limit=200`);
  for (const path of ['/api/orders', '/api/markets?limit=51', '/api/markets?limit=1&limit=2', '/api/markets?status=bad', '/api/markets?url=https://evil.test', '/api/markets?category=../../', `/api/markets/${id}?limit=1`, '/api/markets/not-a-key', `/api/markets/${id}/trades?limit=201`]) assert.throws(() => marketRoute(new URL('http://local' + path)));
});
test('no-key configuration is honest, and live reads fail without contacting Panta', async t => {
  const base = await local(t, { apiKey: '', fetchImpl: () => assert.fail('No key must never contact upstream') });
  const config = await (await fetch(base + '/api/config')).json(); assert.equal(config.connected, false);
  const response = await fetch(base + '/api/markets'); assert.equal(response.status, 503);
  const html = await (await fetch(base)).text(); assert.match(html, /Powered by/); assert.match(html, /Open synthetic example/);
});
test('catalog preserves null prices and pagination; credentials remain in upstream headers', async t => {
  const base = await local(t, { apiKey: fakeKey, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://live-api.panta.market/api/v1/markets/?limit=20&cursor=next-page');
    assert.equal(options.headers['X-Api-Key'], fakeKey); assert.equal(options.redirect, 'error'); assert(options.signal);
    return Response.json({ items: [{ marketId: id, yesPrice: null, noPrice: null }], nextCursor: 'opaque-next' });
  } });
  const response = await fetch(base + '/api/markets?limit=20&cursor=next-page'); const raw = await response.text(); assert(!raw.includes(fakeKey));
  const result = JSON.parse(raw); assert.equal(result.data.items[0].yesPrice, null); assert.equal(result.data.nextCursor, 'opaque-next'); assert(Number.isFinite(Date.parse(result.observedAt)));
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('detail and tape honor their different documented response shapes', async t => {
  const base = await local(t, { apiKey: fakeKey, fetchImpl: async url => url.includes('/trades/') ? Response.json({ marketId: id, items: [{ id: 1, yesAmount: '100', blockTime: null }] }) : Response.json({ marketId: id, yesPrice: '0.61', noPrice: null }) });
  assert.equal((await (await fetch(base + `/api/markets/${id}`)).json()).data.yesPrice, '0.61');
  assert.equal((await (await fetch(base + `/api/markets/${id}/trades`)).json()).data.items[0].blockTime, null);
});
test('upstream errors cannot reflect the API key or internal details into the browser', async t => {
  const base = await local(t, { apiKey: fakeKey, fetchImpl: async () => Response.json({ message: fakeKey, stack: 'internal' }, { status: 401 }) });
  const response = await fetch(base + '/api/markets'); const text = await response.text(); assert.equal(response.status, 401); assert(!text.includes(fakeKey)); assert(!text.includes('internal'));
});

test('a paid read gate stops all subsequent upstream calls', async t => {
  let calls = 0;
  const testKey = 'pk_test_fake_secret_never_returned';
  const base = await local(t, { apiKey: testKey, fetchImpl: async () => { calls++; return Response.json({ secret: testKey }, { status: 402 }); } });
  const config = await (await fetch(base + '/api/config')).json();
  assert.equal(config.keyEnvironment, 'test');
  assert.equal(JSON.stringify(config).includes(testKey), false);
  for (const path of ['/api/markets', `/api/markets/${id}`]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 402);
    const text = await response.text();
    assert.match(text, /requires payment/);
    assert.equal(text.includes(testKey), false);
  }
  assert.equal(calls, 1);
});
test('429 triggers shared cooldown rather than hammering Panta again', async t => {
  let calls = 0;
  const base = await local(t, { apiKey: fakeKey, fetchImpl: async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '30' } }); } });
  for (let i = 0; i < 2; i++) { const response = await fetch(base + '/api/markets'); assert.equal(response.status, 429); assert((await response.json()).retryAfter > 0); }
  assert.equal(calls, 1);
});
test('malformed responses and network failures give a sanitized error', async t => {
  const base = await local(t, { apiKey: fakeKey, fetchImpl: async () => Response.json({ notTheMarketCatalog: [] }) });
  assert.equal((await fetch(base + '/api/markets')).status, 502);
  const failed = await local(t, { apiKey: fakeKey, fetchImpl: async () => { throw new Error(fakeKey); } });
  const response = await fetch(failed + '/api/markets'); assert.equal(response.status, 502); assert(!(await response.text()).includes(fakeKey));
});
test('the upstream read is aborted at the configured timeout', async t => {
  const base = await local(t, { apiKey: fakeKey, timeoutMs: 10, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  const response = await fetch(base + '/api/markets'); assert.equal(response.status, 502);
});
test('write requests, foreign origins, rebound hostnames and arbitrary paths are blocked', async t => {
  const base = await local(t, { apiKey: fakeKey, fetchImpl: () => assert.fail('must not call Panta') });
  assert.equal((await fetch(base + '/api/markets', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/api/config', { headers: { Origin: 'https://evil.test' } })).status, 403);
  // Node fetch overrides Host; use a raw HTTP request to exercise rebinding protection.
  const hostStatus = await new Promise((resolve, reject) => { const req = http.get(base + '/api/config', { headers: { Host: 'evil.test' } }, response => { response.resume(); resolve(response.statusCode); }); req.on('error', reject); });
  assert.equal(hostStatus, 403);
  assert.equal((await fetch(base + '/secrets.env')).status, 404);
  assert.equal((await fetch(base + '/api/orders')).status, 400);
});
