import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { persistApiKey, loadApiKey } from '../api-key-store.mjs';

test('Windows storage encrypts a disposable fixture and round-trips without logging it', { skip: process.platform !== 'win32' }, async t => {
  const filename = `qa-${randomUUID()}.xml`;
  const path = new URL(`../private/${filename}`, import.meta.url);
  const fixture = `pk_test_disposable_${randomUUID().replaceAll('-', '')}`;
  t.after(async () => { try { await unlink(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } });
  try { await persistApiKey(fixture, { filename }); }
  catch { assert.fail('Disposable fixture encryption failed.'); }
  assert.equal((await readFile(path, 'utf8')).includes(fixture), false);
  let restored;
  try { restored = await loadApiKey({ filename }); }
  catch { assert.fail('Disposable fixture decryption failed.'); }
  assert.equal(restored, fixture);
});
