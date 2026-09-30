import { createServer } from './server.mjs';
import { loadApiKey } from './api-key-store.mjs';

try {
  const key = await loadApiKey({ filename: process.argv.includes('--live') ? 'panta-live-api-key.xml' : 'panta-api-key.xml' });
  const server = createServer({ apiKey: key });
  server.on('error', () => { console.error('Could not start saved-key viewer.'); process.exitCode = 1; });
  server.listen(4318, '127.0.0.1', () => console.log('Resolution Lens: http://127.0.0.1:4318 · encrypted key loaded, API connection not yet verified'));
} catch { console.error('Saved developer key unavailable. No viewer started.'); process.exitCode = 1; }
