import { price, review, isStale } from '/review.mjs';
import { examples, exampleTrades } from '/examples.mjs';
const $ = id => document.getElementById(id);
const state = { mode: null, configured: false, keyEnvironment: null, markets: [], cursor: null, selected: null, detail: null, comparisons: new Map(), tape: null, tapeAt: null, generation: 0, detailGeneration: 0, busy: false, retryUntil: 0 };
function node(tag, text, className) { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; }
function marketTitle(market) { return market.title?.trim() || `Title unavailable · ${String(market.marketId).slice(0, 6)}…${String(market.marketId).slice(-4)}`; }
function notice(text) { $('notice').hidden = !text; $('notice').textContent = text; }
function date(seconds) { const value = Number(seconds); return Number.isFinite(value) && value > 0 && value <= 8_640_000_000_000 ? new Date(value * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'Unavailable'; }
function pct(value) { const parsed = price(value); return parsed === null ? 'Unavailable' : `${(parsed * 100).toFixed(1)}¢`; }
function money(value) { const amount = Number(value); return value !== null && value !== undefined && value !== '' && Number.isFinite(amount) ? `${amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC` : 'Unavailable'; }
function stamp(observedAt) { const time = Date.parse(observedAt); return Number.isFinite(time) ? new Date(time).toLocaleTimeString() : 'unknown'; }
function observation(observedAt) { return `${state.mode === 'example' ? 'Synthetic data' : state.mode === 'sandbox' ? 'Fetched test data' : 'Fetched'} · ${stamp(observedAt)} · ${isStale(observedAt) ? 'over 60s old — refresh' : 'less than 60s old'}`; }
function observedNode(observedAt) { const p = node('p', observation(observedAt), `observed${isStale(observedAt) ? ' stale' : ''}`); p.dataset.observedAt = observedAt; return p; }
function safeLink(url, text) { const a = node('a', text); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
function button(text, action, className = 'secondary') { const b = node('button', text, className); b.type = 'button'; b.addEventListener('click', action); return b; }
function controls() {
  const blocked = state.busy || state.retryUntil > Date.now();
  $('live-button').disabled = !state.configured || blocked;
  $('more').disabled = blocked; $('refresh').disabled = !state.selected || blocked;
  $('filters').querySelector('button').disabled = !state.mode || blocked;
  $('export').disabled = !state.comparisons.size;
}
async function api(path) {
  if (state.retryUntil > Date.now()) throw new Error('Rate limit cooldown is still active.');
  const response = await fetch(path, { signal: AbortSignal.timeout(15_000) });
  const payload = await response.json();
  if (!response.ok) {
    if (payload.retryAfter) state.retryUntil = Date.now() + payload.retryAfter * 1000;
    throw new Error(payload.error ?? 'Could not load market data.');
  }
  return payload;
}
function renderCatalog() {
  const search = $('search').value.toLowerCase().trim();
  const visible = state.markets.filter(m => `${m.title ?? ''} ${m.description ?? ''} ${m.marketId} ${m.category ?? ''} ${m.phase ?? ''}`.toLowerCase().includes(search));
  $('market-count').textContent = `${state.markets.length} loaded`;
  $('markets').replaceChildren();
  for (const market of visible) {
    const b = button('', () => selectMarket(market.marketId), 'market-card');
    b.setAttribute('aria-pressed', String(state.selected === market.marketId));
    const meta = node('span', undefined, 'market-meta'); meta.append(node('span', market.category ?? 'Uncategorized'), node('span', market.phase ?? 'Unknown'));
    b.append(meta, node('strong', marketTitle(market)), node('span', `Volume ${money(market.volumeUsdc)}`, 'market-sub'));
    $('markets').append(b);
  }
  if (!visible.length) $('markets').append(node('p', state.markets.length ? 'No loaded markets match this search. Search applies only to pages you have loaded.' : 'No markets returned for these filters.', 'empty'));
  $('more').hidden = !state.cursor; controls();
}
async function loadCatalog(append = false) {
  if (!state.mode || state.busy) return;
  const generation = ++state.generation;
  state.busy = true; controls(); notice('Loading catalog…');
  if (!append) { state.detailGeneration++; state.selected = null; state.detail = null; state.tape = null; state.markets = []; state.cursor = null; renderDetail(); renderCatalog(); }
  try {
    const phase = $('phase').value, category = $('category').value.trim();
    let items, nextCursor;
    if (state.mode === 'example') {
      items = examples().filter(m => (!phase || m.phase === phase) && (!category || m.category === category)); nextCursor = null;
    } else {
      const params = new URLSearchParams({ limit: '20' });
      if (phase) params.set('status', phase); if (category) params.set('category', category); if (append && state.cursor) params.set('cursor', state.cursor);
      const { data } = await api(`/api/markets?${params}`); items = data.items; nextCursor = data.nextCursor;
    }
    if (generation !== state.generation) return;
    state.markets = [...new Map([...(append ? state.markets : []), ...items].map(m => [m.marketId, m])).values()];
    state.cursor = nextCursor; notice(''); renderCatalog();
  } catch (error) { if (generation === state.generation) { notice(error.message); renderCatalog(); } }
  finally { if (generation === state.generation) { state.busy = false; controls(); } }
}
async function selectMarket(id) {
  const generation = ++state.detailGeneration;
  state.selected = id; state.detail = null; state.tape = null; state.tapeAt = null; renderCatalog();
  $('detail').replaceChildren(node('p', 'Loading market detail…', 'empty')); notice('');
  try {
    const result = state.mode === 'example' ? { data: examples().find(m => m.marketId === id), observedAt: new Date().toISOString() } : await api(`/api/markets/${encodeURIComponent(id)}`);
    if (generation !== state.detailGeneration) return;
    if (!result.data) throw new Error('This market is unavailable.');
    state.detail = result;
    state.markets = state.markets.map(m => m.marketId === id ? { ...m, title: result.data.title?.trim() || m.title, description: result.data.description?.trim() || m.description } : m);
    if (state.comparisons.has(id)) state.comparisons.set(id, result);
    renderCatalog(); renderDetail(); renderComparison();
  } catch (error) { if (generation === state.detailGeneration) { $('detail').replaceChildren(node('p', error.message, 'empty')); notice(error.message); } }
  controls();
}
function renderDetail() {
  const container = $('detail'); container.replaceChildren();
  if (!state.detail) { container.append(node('p', 'Open a market to review its rules and linked evidence.', 'empty')); return; }
  const { data: m, observedAt } = state.detail, checks = review(m);
  const meta = node('div', undefined, 'detail-meta'); meta.append(node('span', m.category ?? 'Uncategorized', 'pill'), node('span', m.phase ?? 'Unknown phase', 'pill'));
  const heading = node('h3', marketTitle(m), 'detail-title');
  const time = observedNode(observedAt);
  const quotes = node('div', undefined, 'prices');
  for (const [label, value] of [['YES', m.yesPrice], ['NO', m.noPrice]]) { const q = node('div', undefined, `quote ${label === 'NO' ? 'no' : ''}`); q.append(node('span', label), node('strong', price(value) === null ? '—' : pct(value))); q.setAttribute('aria-label', `${label} spot price ${pct(value)}`); quotes.append(q); }
  const timeline = node('div', undefined, 'timeline');
  for (const [label, value] of [['Started', m.startTime], ['Primary ends', m.endTime], ['Resolution', m.resolutionTime]]) { const point = node('div'); point.append(node('b', label), node('time', date(value))); timeline.append(point); }
  container.append(meta, heading, node('p', `Market ID: ${m.marketId}`, 'market-id'), time, quotes, node('p', 'Spot prices per share, shown in cents. YES and NO quotes are independent and may not add to 100¢.', 'price-note'), timeline, node('h2', 'Stated rules', 'rule-heading'), node('p', m.description?.trim() || 'No resolution wording returned by Panta. This review cannot assess the event or its rules.', 'rules'));
  const sources = node('div', undefined, 'source-list'); for (const url of checks.sources) sources.append(safeLink(url, new URL(url).hostname)); container.append(sources);
  const flags = node('div', undefined, 'flag-list');
  for (const flag of checks.flags) { const card = node('div', undefined, 'flag'); card.append(node('strong', flag.title), node('span', flag.detail)); flags.append(card); }
  if (!checks.flags.length) flags.append(node('p', 'No missing fields detected by these checks. Read the full rules to assess ambiguity.', 'no-flags'));
  container.append(flags);
  const actions = node('div', undefined, 'detail-actions');
  const add = button(state.comparisons.has(m.marketId) ? 'In comparison' : 'Add to comparison', () => { if (state.comparisons.size >= 3 && !state.comparisons.has(m.marketId)) return notice('Remove one market before adding another.'); state.comparisons.set(m.marketId, state.detail); renderComparison(); renderDetail(); });
  add.disabled = state.comparisons.has(m.marketId); actions.append(add);
  const loadTape = button(state.tape ? 'Refresh trade tape' : 'Load trade tape', loadTrades); loadTape.disabled = state.retryUntil > Date.now(); actions.append(loadTape); container.append(actions);
  if (state.tape) renderTape(container);
}
async function loadTrades() {
  if (!state.detail) return;
  const generation = state.detailGeneration, id = state.selected;
  notice('Loading trade tape…');
  try {
    const result = state.mode === 'example' ? { data: exampleTrades(id), observedAt: new Date().toISOString() } : await api(`/api/markets/${encodeURIComponent(id)}/trades?limit=50`);
    if (generation !== state.detailGeneration) return;
    state.tape = result.data; state.tapeAt = result.observedAt; renderDetail(); notice('');
  } catch (error) { if (generation === state.detailGeneration) notice(error.message); }
}
function renderTape(container) {
  const section = node('section', undefined, 'trade-section'); section.append(node('h2', 'Recent trade tape'), observedNode(state.tapeAt), node('p', 'Latest 50 records at most; this is not a complete volume history.', 'trade-help'));
  if (!state.tape.items.length) { section.append(node('p', 'No recent trades returned.', 'empty')); container.append(section); return; }
  const scroll = node('div', undefined, 'table-scroll'), table = node('table'), head = node('thead'), hr = node('tr');
  for (const title of ['Time', 'YES amount', 'NO amount', 'Phase', 'Transaction']) hr.append(node('th', title)); head.append(hr); table.append(head);
  const body = node('tbody');
  for (const trade of state.tape.items) {
    const row = node('tr'); for (const value of [date(trade.blockTime), String(trade.yesAmount ?? 'Unavailable'), String(trade.noAmount ?? 'Unavailable'), trade.isPrimary ? 'Primary' : 'Secondary']) row.append(node('td', value));
    const tx = node('td'); if (/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(trade.signature ?? '')) tx.append(safeLink(`https://solscan.io/tx/${trade.signature}`, 'View')); else tx.textContent = state.mode === 'example' ? 'Synthetic' : 'Unavailable'; row.append(tx); body.append(row);
  }
  table.append(body); scroll.append(table); section.append(scroll, node('p', 'Amounts are shown as returned by Panta; no denomination or unit conversion is inferred.', 'trade-help')); container.append(section);
}
function renderComparison() {
  const container = $('comparison'); container.replaceChildren();
  if (!state.comparisons.size) { container.append(node('p', 'Add a market from its review to compare prices, dates and missing evidence.', 'empty')); controls(); return; }
  const grid = node('div', undefined, 'compare-grid');
  for (const [id, { data: m, observedAt }] of state.comparisons) {
    const checks = review(m), card = node('article', undefined, 'compare-card'), list = node('dl'); card.append(node('h3', marketTitle(m)));
    for (const [label, value] of [['YES / NO spot price', `${pct(m.yesPrice)} / ${pct(m.noPrice)}`], ['Resolution', date(m.resolutionTime)], ['Linked sources / review flags', `${checks.sources.length} / ${checks.flags.length}`]]) list.append(node('dt', label), node('dd', value));
    card.append(list, observedNode(observedAt), button('Remove', () => { state.comparisons.delete(id); renderComparison(); renderDetail(); })); grid.append(card);
  }
  container.append(grid); controls();
}
function switchMode(mode) {
  state.generation++; state.detailGeneration++; state.busy = false; state.mode = mode; state.comparisons.clear(); state.markets = []; state.detail = null; state.selected = null; state.cursor = null; state.tape = null;
  $('mode-label').textContent = mode === 'example' ? 'Synthetic example · no live market data' : mode === 'sandbox' ? 'Panta test API · no mainnet market data' : 'Panta market API · read-only';
  $('connection-note').textContent = mode === 'example' ? 'Invented markets and trades for trying the review. No real prices, events or outcomes.' : mode === 'sandbox' ? 'Authenticated test-key requests return Panta fixture data. These are not real market prices or trades.' : 'Each detail is fetched on request. No trades or wallet actions are available.';
  renderComparison(); loadCatalog();
}
$('example-button').addEventListener('click', () => switchMode('example'));
$('live-button').addEventListener('click', () => switchMode(state.keyEnvironment === 'test' ? 'sandbox' : 'live'));
$('filters').addEventListener('submit', event => { event.preventDefault(); loadCatalog(); });
$('search').addEventListener('input', renderCatalog);
$('more').addEventListener('click', () => loadCatalog(true));
$('refresh').addEventListener('click', () => selectMarket(state.selected));
$('export').addEventListener('click', () => {
  const snapshot = { product: 'Resolution Lens', mode: state.mode, pantaKeyEnvironment: state.mode === 'example' ? null : state.keyEnvironment, synthetic: state.mode === 'example' || state.mode === 'sandbox', exportedAt: new Date().toISOString(), notes: 'Point-in-time research, not a prediction. Test API and example data are synthetic. Amounts and prices may be unavailable. Rule flags do not establish outcome validity.', markets: [...state.comparisons.values()].map(result => ({ ...result, review: review(result.data) })) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })); const a = node('a'); a.href = url; a.download = `resolution-lens-${state.mode}-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  notice('Research snapshot saved. It records the data source and fetch time.');
});
setInterval(() => { if (!document.hidden) { controls(); for (const p of document.querySelectorAll('[data-observed-at]')) { p.textContent = observation(p.dataset.observedAt); p.classList.toggle('stale', isStale(p.dataset.observedAt)); } } }, 15_000);
try {
  const response = await fetch('/api/config'); if (!response.ok) throw new Error('config'); const config = await response.json(); state.configured = config.connected; state.keyEnvironment = config.keyEnvironment;
  $('live-button').textContent = state.keyEnvironment === 'test' ? 'Load Panta test markets' : 'Load live markets';
  $('mode-label').textContent = state.configured ? state.keyEnvironment === 'test' ? 'Panta test key configured · connection unverified' : 'Server key configured · live connection unverified' : 'Live connection not configured';
  $('connection-note').textContent = state.configured ? state.keyEnvironment === 'test' ? 'Load Panta test markets to check authenticated access. Test data does not establish real market integration.' : 'Load live markets to check authenticated access to Panta.' : 'Set PANTA_API_KEY on the local server to load live markets. The example works without an account.';
} catch { $('mode-label').textContent = 'Local server unavailable'; notice('Restart the local server, then reload this page.'); }
controls();
