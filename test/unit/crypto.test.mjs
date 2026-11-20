import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../../lib/crypto.js';

test('vault round-trips through passphrase and recovery key', async () => {
  const k = await c.createVaultKeys('correct horse battery staple');
  const vault = { ...k };
  const sealed = await c.encryptEntry(k.vaultKey, { name: 'Netflix', secret: 'p@ss ✓ 日本' });
  assert.match(sealed, /^v1\./);
  const viaPass = await c.unlockWithPassphrase(vault, 'correct horse battery staple');
  assert.equal((await c.decryptEntry(viaPass, sealed)).secret, 'p@ss ✓ 日本');
  const typed = k.recoveryKey.toLowerCase().replace(/-/g, ' ');
  const viaRec = await c.unlockWithRecoveryKey(vault, typed);
  assert.equal((await c.decryptEntry(viaRec, sealed)).name, 'Netflix');
});

test('wrong secrets are refused', async () => {
  const k = await c.createVaultKeys('right passphrase here');
  await assert.rejects(c.unlockWithPassphrase(k, 'wrong passphrase'));
  await assert.rejects(c.unlockWithRecoveryKey(k, c.newRecoveryKey()));
});

test('changing passphrase and recovery key keeps entries readable', async () => {
  const k = await c.createVaultKeys('first passphrase!!');
  const sealed = await c.encryptEntry(k.vaultKey, { a: 1 });
  const vault = { ...k, ...(await c.changePassphrase(k, 'first passphrase!!', 'second passphrase!!')) };
  await assert.rejects(c.unlockWithPassphrase(vault, 'first passphrase!!'));
  const key2 = await c.unlockWithPassphrase(vault, 'second passphrase!!');
  assert.deepEqual(await c.decryptEntry(key2, sealed), { a: 1 });
  const r = await c.replaceRecoveryKey(vault, 'second passphrase!!');
  const v2 = { ...vault, ...r };
  await assert.rejects(c.unlockWithRecoveryKey(v2, k.recoveryKey));
  assert.deepEqual(await c.decryptEntry(await c.unlockWithRecoveryKey(v2, r.recoveryKey), sealed), { a: 1 });
});

test('recovery key format and vault key is not extractable', async () => {
  const key = c.newRecoveryKey();
  assert.match(key, /^([A-HJ-NP-Z2-9]{4}-){5}[A-HJ-NP-Z2-9]{4}$/);
  assert.ok(c.looksLikeRecoveryKey(key.toLowerCase()));
  assert.ok(!c.looksLikeRecoveryKey('ABCD-0000'));
  const k = await c.createVaultKeys('x'.repeat(14));
  assert.equal(k.vaultKey.extractable, false);
});

test('large payloads do not overflow', async () => {
  const k = await c.createVaultKeys('x'.repeat(14));
  const big = 'z'.repeat(500000);
  assert.equal((await c.decryptEntry(k.vaultKey, await c.encryptEntry(k.vaultKey, { big }))).big.length, 500000);
});
