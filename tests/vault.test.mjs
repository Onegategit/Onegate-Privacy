import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealFile, openFile, MAX_FILE_SIZE } from '../src/vault-crypto.js';
const password = 'a long independent test passphrase';
test('vault round trip preserves content and encrypted filename', async () => {
  const bytes = new TextEncoder().encode('Onegate private test content');
  const sealed = await sealFile(bytes, 'private.txt', 'text/plain', password);
  assert.ok(!new TextDecoder().decode(sealed).includes('private.txt'));
  const result = await openFile(sealed, password);
  assert.equal(result.name, 'private.txt'); assert.deepEqual(result.bytes, bytes);
});
test('each encryption has independent randomness', async () => {
  const a = await sealFile(new Uint8Array(), 'empty', '', password);
  const b = await sealFile(new Uint8Array(), 'empty', '', password);
  assert.notDeepEqual(a, b);
  assert.equal((await openFile(a, password)).bytes.length, 0);
});
test('incorrect passwords and modified ciphertext fail authentication', async () => {
  const a = await sealFile(new Uint8Array([1,2,3]), 'test.bin', '', password);
  await assert.rejects(openFile(a, 'a different long passphrase'), /Unable to decrypt/);
  a[a.length-1] ^= 1; await assert.rejects(openFile(a, password), /Unable to decrypt/);
});
test('invalid format, oversized files and weak inputs are rejected', async () => {
  await assert.rejects(openFile(new Uint8Array(100), password), /not a supported/);
  await assert.rejects(sealFile(new Uint8Array(MAX_FILE_SIZE+1), 'test', '', password), /20 MB/);
  await assert.rejects(sealFile(new Uint8Array(), 'test', '', 'short'), /12 and 1024/);
});
