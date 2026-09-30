// Panta prices are strings or null. Missing catalog prices are not zero.
export function price(value) {
  if (!['string', 'number'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

export function sourceLinks(description = '') {
  const found = String(description).match(/https?:\/\/[^\s<>"']+/g) ?? [];
  return [...new Set(found.map(link => link.replace(/[.,;!?)\]]+$/, '')))]
    .filter(link => { try { const u = new URL(link); return !u.username && !u.password; } catch { return false; } });
}

export function review(market, now = Date.now()) {
  const sources = sourceLinks(market.description);
  const flags = [];
  const resolution = Number(market.resolutionTime);
  const resolutionMs = Number.isFinite(resolution) && resolution > 0 && resolution <= 8_640_000_000_000 ? resolution * 1000 : null;
  if (!sources.length) flags.push({ kind: 'source', title: 'No linked source in description', detail: 'Check the full rules for the authority used to resolve this market.' });
  if (!resolutionMs) flags.push({ kind: 'time', title: 'Resolution time unavailable', detail: 'The returned market does not state a usable resolution timestamp.' });
  if (resolutionMs && resolutionMs < now && !market.resolved && market.phase !== 'cancelled') {
    flags.push({ kind: 'past', title: 'Resolution time has passed', detail: 'The timestamp is in the past and this market is not marked resolved. This does not prove a disputed or incorrect outcome.' });
  }
  if (price(market.yesPrice) === null || price(market.noPrice) === null) flags.push({ kind: 'price', title: 'Spot price incomplete', detail: 'Panta may return null when on-chain prices are unavailable. No price is inferred.' });
  return { sources, flags, resolutionMs };
}

export function isStale(observedAt, now = Date.now()) {
  const stamp = Date.parse(observedAt);
  return !Number.isFinite(stamp) || now - stamp > 60_000;
}
