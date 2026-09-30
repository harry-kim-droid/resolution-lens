import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createKeySetupServer, keyOptions } from '../api-access-setup.mjs';

const jwt = 'eyJfixture.payload.signature';
const secret = 'pk_test_fixture_secret_never_returned';
async function fixture(t, options = {}) {
  const server = createKeySetupServer({ csrfToken: 'fixture-csrf', ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body = { access: jwt }, headers = {}) => fetch(base + '/issue-key', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Setup-CSRF': 'fixture-csrf', ...headers }, body: JSON.stringify(body) });
  return { server, base, post };
}

test('fixed issuance preserves old keys and never returns credentials', async t => {
  let calls = 0;
  let saved;
  const { base, post } = await fixture(t, { fetchImpl: async (url, init) => { calls++; assert.equal(url, 'https://live-api.panta.market/api/v1/account/keys/'); assert.equal(init.headers.Authorization, `Bearer ${jwt}`); assert.deepEqual(JSON.parse(init.body), keyOptions); assert.equal(init.redirect, 'error'); return Response.json({ secret }, { status: 201 }); }, persistKey: async key => { saved = key; } });
  assert.equal((await fetch(base + '/status')).status, 200);
  assert.equal(calls, 0);
  const response = await post();
  const text = await response.text();
  assert.equal(response.status, 201);
  assert.equal(saved, secret);
  assert.equal(text.includes(secret) || text.includes(jwt), false);
  assert.equal((await post()).status, 409);
  assert.equal(calls, 1);
});

test('live issuance is an explicit option and keeps the secret outside the browser', async t => {
  const liveSecret = 'pk_live_fixture_secret_never_returned';
  let saved;
  const { base, post } = await fixture(t, { env: 'live', fetchImpl: async (_url, init) => {
    assert.deepEqual(JSON.parse(init.body), { ...keyOptions, env: 'live' });
    return Response.json({ secret: liveSecret }, { status: 201 });
  }, persistKey: async key => { saved = key; } });
  const page = await (await fetch(base)).text();
  assert.match(page, /private\/panta-live-api-key\.xml/);
  const response = await post();
  assert.equal(response.status, 201);
  assert.equal(saved, liveSecret);
  assert.equal((await response.text()).includes(liveSecret), false);
});

test('rejects hostile origins, hostnames, missing CSRF and arbitrary payloads before upstream', async t => {
  let calls = 0;
  const { base, post } = await fixture(t, { fetchImpl: async () => { calls++; throw new Error('unexpected'); } });
  assert.equal((await post(undefined, { Origin: 'https://foreign.example' })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const req = request(base + '/status', { headers: { Host: 'foreign.example' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(foreignHostStatus, 403);
  assert.equal((await post(undefined, { 'X-Setup-CSRF': '' })).status, 403);
  assert.equal((await post({ access: jwt, url: 'https://foreign.example' })).status, 400);
  assert.equal((await post({ access: 'not-a-token' })).status, 400);
  assert.equal((await fetch(base + '/trade', { method: 'POST' })).status, 404);
  assert.equal(calls, 0);
});

test('paid gate and upstream failures do not save credentials or expose responses', async t => {
  const { post } = await fixture(t, { fetchImpl: async () => Response.json({ message: secret, access: jwt }, { status: 402 }), persistKey: async () => { assert.fail('no save expected'); } });
  const response = await post();
  assert.equal(response.status, 402);
  const body = await response.text();
  assert.match(body, /requires payment/);
  assert.equal(body.includes(secret) || body.includes(jwt), false);
});

test('storage failure remembers issuance and prevents creating another key', async t => {
  let calls = 0;
  const { base, post } = await fixture(t, { fetchImpl: async () => { calls++; return Response.json({ secret }, { status: 201 }); }, persistKey: async () => { throw new Error(secret); } });
  assert.equal((await post()).status, 500);
  assert.deepEqual(await (await fetch(base + '/status')).json(), { issued: true, stored: false, uncertain: false });
  assert.equal((await post()).status, 409);
  assert.equal(calls, 1);
});

test('concurrent submissions cannot issue duplicate keys', async t => {
  let finish;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const { post } = await fixture(t, { fetchImpl: async () => { entered(); return await new Promise(resolve => { finish = () => resolve(Response.json({ secret }, { status: 201 })); }); }, persistKey: async () => {} });
  const first = post();
  await started;
  assert.equal((await post()).status, 409);
  finish();
  assert.equal((await first).status, 201);
});

test('an ambiguous network failure prevents repeated key issuance', async t => {
  let calls = 0;
  const { base, post } = await fixture(t, { fetchImpl: async () => { calls++; throw new Error(jwt); } });
  const response = await post();
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes(jwt), false);
  assert.deepEqual(await (await fetch(base + '/status')).json(), { issued: false, stored: false, uncertain: true });
  assert.equal((await post()).status, 409);
  assert.equal(calls, 1);
});
