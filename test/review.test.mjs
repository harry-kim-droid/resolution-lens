import test from 'node:test';
import assert from 'node:assert/strict';
import { price, review, sourceLinks, isStale } from '../lib/review.mjs';
import { examples } from '../lib/examples.mjs';

test('absent or malformed prices stay unavailable, including whitespace and booleans', () => {
  for (const input of [null, undefined, '', ' ', false, [], {}, 'bad', '-0.1', '1.01', Infinity]) assert.equal(price(input), null);
  assert.equal(price('0'), 0); assert.equal(price('0.61'), .61); assert.equal(price(1), 1);
});
test('linked authorities are unique HTTP URLs without embedded credentials', () => {
  assert.deepEqual(sourceLinks('Rules: https://example.com/results. See https://example.com/results, and javascript:alert(1) plus https://user:secret@example.org.'), ['https://example.com/results']);
});
test('passed resolution is a review flag only for unresolved, non-cancelled markets', () => {
  const base = { description: 'https://example.com', resolutionTime: 100, resolved: false, phase: 'secondary', yesPrice: '0.4', noPrice: '0.6' };
  assert.deepEqual(review(base, 200_000).flags.map(f => f.kind), ['past']);
  assert.equal(review({ ...base, resolved: true }, 200_000).flags.length, 0);
  assert.equal(review({ ...base, phase: 'cancelled' }, 200_000).flags.length, 0);
});
test('missing resolution, source and price are distinct checks; no outcome is fabricated', () => {
  assert.deepEqual(review({ description: '', resolutionTime: null, yesPrice: null, noPrice: null }).flags.map(f => f.kind), ['source', 'time', 'price']);
  assert.equal(review({ resolutionTime: Infinity }).resolutionMs, null);
});
test('observation staleness uses fetch time and handles invalid dates', () => {
  assert.equal(isStale('invalid', 1000), true);
  assert.equal(isStale(new Date(0).toISOString(), 60_000), false);
  assert.equal(isStale(new Date(0).toISOString(), 60_001), true);
});
test('example dataset is explicitly synthetic and supplies an incomplete resolution case', () => {
  const markets = examples(1_800_000_000_000);
  assert.equal(markets.length, 3);
  assert(markets.every(m => m.description.startsWith('SYNTHETIC EXAMPLE')));
  assert.deepEqual(review(markets[1], 1_800_000_000_000).flags.map(f => f.kind), ['source', 'past', 'price']);
});
