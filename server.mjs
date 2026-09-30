import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const upstream = 'https://live-api.panta.market/api/v1';
const validId = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const files = new Map([['/', ['index.html', 'text/html']], ['/app.mjs', ['app.mjs', 'text/javascript']], ['/style.css', ['style.css', 'text/css']], ['/review.mjs', ['../lib/review.mjs', 'text/javascript']], ['/examples.mjs', ['../lib/examples.mjs', 'text/javascript']]]);

export function marketRoute(url) {
  if (url.pathname === '/api/markets') {
    const allowed = new Set(['category', 'status', 'cursor', 'limit']);
    for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new Error('query');
    const limit = url.searchParams.get('limit') ?? '20';
    if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 50) throw new Error('limit');
    const status = url.searchParams.get('status');
    if (status && !['primary', 'secondary', 'resolved', 'cancelled'].includes(status)) throw new Error('status');
    const category = url.searchParams.get('category');
    if (category && !/^[a-zA-Z0-9_-]{1,64}$/.test(category)) throw new Error('category');
    const cursor = url.searchParams.get('cursor');
    if (cursor && (cursor.length > 256 || /[\x00-\x1f]/.test(cursor))) throw new Error('cursor');
    const params = new URLSearchParams(url.searchParams);
    params.set('limit', limit);
    return `/markets/?${params}`;
  }
  const match = url.pathname.match(/^\/api\/markets\/([^/]+)(\/trades)?$/);
  if (!match || !validId.test(match[1])) throw new Error('market');
  const allowed = match[2] ? new Set(['limit']) : new Set();
  for (const key of url.searchParams.keys()) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new Error('query');
  if (!match[2]) return `/markets/${match[1]}/`;
  const limit = url.searchParams.get('limit') ?? '50';
  if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 200) throw new Error('limit');
  return `/markets/${match[1]}/trades/?limit=${limit}`;
}

function errorMessage(status) {
  return ({ 401: 'Panta rejected the server API key. Check its configuration.', 402: 'Panta requires payment. Further API requests are stopped.', 403: 'This API key cannot read this resource.', 404: 'Panta could not find this market.', 429: 'Panta rate limit reached. Wait before trying again.' })[status] ?? 'Panta is unavailable. Try again later.';
}

export function createServer({ apiKey = process.env.PANTA_API_KEY ?? '', fetchImpl = fetch, timeoutMs = 12_000 } = {}) {
  let retryUntil = 0;
  let paymentRequired = false;
  const keyEnvironment = !apiKey ? null : apiKey.startsWith('pk_test_') ? 'test' : apiKey.startsWith('pk_live_') ? 'live' : 'unknown';
  return http.createServer(async (req, res) => {
    const json = (status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(payload)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    // Limit the private-key proxy to this local browser, including DNS-rebinding attempts.
    const hostname = String(req.headers.host ?? '').split(':')[0];
    if (!['127.0.0.1', 'localhost'].includes(hostname)) return json(403, { error: 'Local access only.' });
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(403, { error: 'Cross-origin access denied.' });
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Cross-site access denied.' });
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return json(405, { error: 'Read-only service.' }); }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/config') return json(200, { connected: Boolean(apiKey), provider: 'Panta', mode: 'read-only', keyEnvironment });
    if (url.pathname.startsWith('/api/')) {
      let path;
      try { path = marketRoute(url); } catch { return json(400, { error: 'Invalid market request.' }); }
      if (!apiKey) return json(503, { error: 'Set PANTA_API_KEY on the server, then restart to load live markets.' });
      if (paymentRequired) return json(402, { error: errorMessage(402) });
      if (retryUntil > Date.now()) return json(429, { error: errorMessage(429), retryAfter: Math.ceil((retryUntil - Date.now()) / 1000) });
      try {
        const response = await fetchImpl(upstream + path, { headers: { 'X-Api-Key': apiKey, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) {
          const status = [400, 401, 402, 403, 404, 429].includes(response.status) ? response.status : 502;
          if (status === 402) paymentRequired = true;
          const retry = response.status === 429 ? Math.min(3600, Math.max(1, Number(response.headers.get('retry-after')) || 60)) : null;
          if (retry) { retryUntil = Date.now() + retry * 1000; res.setHeader('Retry-After', String(retry)); }
          return json(status, { error: errorMessage(status), ...(retry ? { retryAfter: retry } : {}) });
        }
        const data = await response.json();
        // Check the documented response envelopes before showing them as market data.
        if (path.startsWith('/markets/?') && (!data || !Array.isArray(data.items) || !(data.nextCursor === null || typeof data.nextCursor === 'string'))) throw new Error('shape');
        if (path.includes('/trades/') && (!data || !Array.isArray(data.items) || typeof data.marketId !== 'string')) throw new Error('shape');
        if (!path.includes('?') && (!data || typeof data.marketId !== 'string')) throw new Error('shape');
        return json(200, { data, observedAt: new Date().toISOString() });
      } catch { return json(502, { error: 'Panta did not return a usable response. Refresh to try again.' }); }
    }
    const asset = files.get(url.pathname);
    if (!asset) return json(404, { error: 'Not found.' });
    try { const bytes = await readFile(resolve(publicDir, asset[0])); res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` }); res.end(bytes); }
    catch { if (!res.headersSent) return json(500, { error: 'Local asset unavailable.' }); res.end(); }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4317);
  const server = createServer();
  server.on('error', () => { console.error('Could not start Resolution Lens. Check PORT and whether another server is running.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Resolution Lens: http://127.0.0.1:${port} · ${process.env.PANTA_API_KEY ? 'Panta key configured (not yet verified)' : 'no Panta key; synthetic examples available'}`));
}
