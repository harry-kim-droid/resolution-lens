// Invented local fixtures. These are not actual Panta markets or outcomes.
const common = { marketType: 'standard', images: [], region: 'Global', campaignId: null, createdByPartner: false, primaryYesPrice: null, primaryNoPrice: null, secondaryYesPrice: null, secondaryNoPrice: null };
export function examples(now = Date.now()) {
  const seconds = Math.floor(now / 1000);
  return [
    { ...common, marketId: 'example-launch', title: 'Will the Atlas test network launch this month?', category: 'crypto', description: 'SYNTHETIC EXAMPLE — No real event or market. Resolve YES if the project publishes a public launch notice before the stated deadline. The example authority is https://example.com/atlas/announcements. A private beta does not qualify.', phase: 'secondary', resolved: false, status: 'Trading', startTime: seconds - 86400 * 5, endTime: seconds - 86400, resolutionTime: seconds + 86400 * 3, volumeUsdc: '1420.50', yesPrice: '0.61', noPrice: '0.42' },
    { ...common, marketId: 'example-results', title: 'Will the Meadow event publish its final results?', category: 'sports', description: 'SYNTHETIC EXAMPLE — No real event or market. Resolve YES if the final results are published before the deadline. This intentionally incomplete description names no linked source so the review can highlight the missing evidence.', phase: 'secondary', resolved: false, status: 'Trading', startTime: seconds - 86400 * 7, endTime: seconds - 86400 * 3, resolutionTime: seconds - 86400, volumeUsdc: '805.00', yesPrice: null, noPrice: null },
    { ...common, marketId: 'example-release', title: 'Will Northstar release version 2 before its cutoff?', category: 'tech', description: 'SYNTHETIC EXAMPLE — No real event or market. Resolve YES if version 2 is published as a stable release on https://example.com/northstar/releases before the cutoff. Release candidates do not count.', phase: 'primary', resolved: false, status: 'Primary', startTime: seconds - 3600, endTime: seconds + 86400 * 2, resolutionTime: seconds + 86400 * 4, volumeUsdc: '210.00', yesPrice: '0.48', noPrice: '0.52' }
  ];
}
export function exampleTrades(marketId, now = Date.now()) {
  return { marketId, items: marketId === 'example-launch' ? [
    { id: 'example-trade-1', marketId, wallet: 'Synthetic wallet', isPrimary: false, yesAmount: '12.5', noAmount: '0', feePaid: '0.05', blockTime: Math.floor(now / 1000) - 420, signature: 'synthetic', quoteAsset: 'USDC' },
    { id: 'example-trade-2', marketId, wallet: 'Synthetic wallet', isPrimary: false, yesAmount: '0', noAmount: '8', feePaid: '0.03', blockTime: Math.floor(now / 1000) - 960, signature: 'synthetic', quoteAsset: 'USDC' }
  ] : [] };
}
