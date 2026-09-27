import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt } from '../apps/cloudflare/src/auth.js';
import { deviceLogin } from '../packages/pkgfactory/src/github/device.js';
test('session ciphertext is authenticated and bound to its server-side identifier', async () => {
  const env = {SESSION_KEY: btoa('s'.repeat(32))}; const session = {token: 'never-log', subject: '42'};
  const encrypted = await encrypt(env, session, 'session:one');
  assert.equal(JSON.stringify(encrypted).includes(session.token), false);
  assert.deepEqual(await decrypt(env, encrypted, 'session:one'), session);
  await assert.rejects(decrypt(env, encrypted, 'session:two'));
  await assert.rejects(decrypt({SESSION_KEY: btoa('x'.repeat(32))}, encrypted, 'session:one'));
});
test('Device Flow polls only after user-code notification and respects cancellation', async () => {
  const controller = new AbortController(); let calls = 0, notified = false;
  const fetcher: typeof fetch = async () => {
    calls++; return Response.json({device_code: 'secret-device-code', user_code: 'ABCD', verification_uri: 'https://github.com/login/device', expires_in: 30, interval: 1});
  };
  await assert.rejects(deviceLogin('client', (url, code) => {assert.equal(code, 'ABCD'); assert.equal(url, 'https://github.com/login/device'); notified = true; controller.abort();}, controller.signal, fetcher));
  assert.equal(calls, 1); assert.ok(notified);
});
