import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { persistApiKey } from './api-key-store.mjs';

const endpoint = 'https://live-api.panta.market/api/v1/account/keys/';
export const keyOptions = Object.freeze({ env: 'test', name: 'Resolution Lens', revokeOthers: false });

export function createKeySetupServer({ env = 'test', fetchImpl = fetch, persistKey, timeoutMs = 12_000, csrfToken = randomBytes(32).toString('hex') } = {}) {
  if (!['test', 'live'].includes(env)) throw new Error('Invalid key environment.');
  const options = Object.freeze({ ...keyOptions, env });
  const filename = env === 'live' ? 'panta-live-api-key.xml' : 'panta-api-key.xml';
  const saveKey = persistKey ?? (key => persistApiKey(key, { filename }));
  let pending = false;
  let issued = false;
  let stored = false;
  let uncertain = false;
  const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="csrf" content="${csrfToken}"><title>Panta API key setup</title><body><h1>Panta developer key setup</h1><p>Developer registration succeeded. This local page issues one API key through Panta's official API.</p><dl><dt>API destination</dt><dd>${endpoint}</dd><dt>Environment</dt><dd>${env}${env === 'test' ? ' (Panta fixture data, not mainnet)' : ' (actual market access; response not yet verified)'}</dd><dt>Name</dt><dd>Resolution Lens</dd><dt>Revoke existing keys</dt><dd>false</dd><dt>Credential storage</dt><dd>Windows user encryption (DPAPI), private/${filename}</dd></dl><p>The key is account access, not a documented read-only permission scope. The viewer only uses market GET endpoints. API fees remain unconfirmed. No wallet or trade request is made here.</p><form><label for="access">Existing developer access token</label><br><input id="access" type="password" autocomplete="off" spellcheck="false" required><br><button type="submit">Issue API key and save locally</button></form><p id="result" role="status">Awaiting approval. No issuance request has been made.</p><script src="/setup.js"></script></body></html>`;
  const script = `const form=document.querySelector('form'), field=document.querySelector('#access'), result=document.querySelector('#result'), button=document.querySelector('button');form.addEventListener('submit',async event=>{event.preventDefault();button.disabled=true;result.textContent='Issuing through Panta…';try{const response=await fetch('/issue-key',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-CSRF':document.querySelector('meta[name=csrf]').content},body:JSON.stringify({access:field.value})});field.value='';const data=await response.json();result.textContent=data.message||'Setup failed.';if(!data.issued&&!data.uncertain)button.disabled=false;}catch{field.value='';result.textContent='Local setup unavailable. Do not repeat an uncertain issuance request.';}});`;
  return http.createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const expectedHost = `127.0.0.1:${req.socket.localPort}`;
    if (req.headers.host !== expectedHost || req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `http://${expectedHost}`)) return json(403, { message: 'Local access only.' });
    if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(page); }
    if (req.method === 'GET' && req.url === '/setup.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); return res.end(script); }
    if (req.method === 'GET' && req.url === '/status') return json(200, { issued, stored, uncertain });
    if (req.method !== 'POST' || req.url !== '/issue-key') return json(404, { message: 'Not found.' });
    const provided = Buffer.from(String(req.headers['x-setup-csrf'] ?? ''));
    const expected = Buffer.from(csrfToken);
    if (req.headers.origin !== `http://${expectedHost}` || provided.length !== expected.length || !timingSafeEqual(provided, expected)) return json(403, { message: 'Setup confirmation unavailable.' });
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) return json(415, { message: 'JSON required.' });
    if (pending || issued || uncertain) return json(409, { issued, stored, uncertain, message: 'An issuance is pending, completed or uncertain. No additional key requested.' });
    pending = true;
    let access = '';
    let dispatched = false;
    try {
      let body = '';
      for await (const chunk of req) { body += chunk.toString('utf8'); if (body.length > 16_384) throw new Error('request'); }
      const data = JSON.parse(body);
      body = '';
      if (Object.keys(data).length !== 1 || typeof data.access !== 'string' || !/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.access)) return json(400, { message: 'An existing developer JWT is required.' });
      access = data.access;
      data.access = '';
      dispatched = true;
      const upstream = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(options) });
      access = '';
      if (upstream.status !== 201) {
        const status = [400, 401, 403, 402, 429].includes(upstream.status) ? upstream.status : 502;
        uncertain = status === 502;
        return json(status, { uncertain, message: status === 402 ? 'Panta requires payment. Stopped before payment.' : `Panta did not confirm issuance (HTTP ${status}). No automatic retry.` });
      }
      issued = true;
      const created = await upstream.json();
      if (typeof created.secret !== 'string' || !created.secret.startsWith(`pk_${env}_`) || !/^pk_(test|live)_[A-Za-z0-9_-]{8,256}$/.test(created.secret)) return json(502, { issued, stored, message: 'Panta reported issuance with an unexpected secret format. Do not issue another key automatically.' });
      try { await saveKey(created.secret); stored = true; }
      catch { return json(500, { issued, stored, message: 'Key issued, but Windows encrypted storage failed. Do not issue another key automatically.' }); }
      finally { created.secret = ''; }
      return json(201, { issued, stored, message: 'API key issued and saved with Windows user encryption. No market, wallet or trading request made.' });
    } catch { uncertain = dispatched && !issued; return json(dispatched ? 502 : 400, { issued, stored, uncertain, message: 'Setup did not finish. No automatic retry; check status before another request.' }); }
    finally { access = ''; pending = false; }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const setup = createKeySetupServer({ env: process.argv.includes('--live') ? 'live' : 'test' });
  setup.on('error', () => { console.error('Could not start local API setup.'); process.exitCode = 1; });
  setup.listen(4319, '127.0.0.1', () => console.log('Panta API setup: http://127.0.0.1:4319 · no issuance request sent'));
}
