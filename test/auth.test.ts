import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, exchangeGitHub, type Env } from '../apps/cloudflare/src/auth.js';
import { errorResponse } from '../packages/pkgfactory/src/web/http.js';
import { deviceLogin } from '../packages/pkgfactory/src/github/device.js';
import { consentNotices } from '../apps/cloudflare/src/consent.js';

test('consent identifies loopback redirects and the actual CIMD domain', () => {
  for (const address of ['http://localhost:3000/callback', 'http://127.0.0.2:3000/callback', 'http://[::1]:3000/callback']) assert.match(consentNotices('registered-client', address), /your own device/);
  assert.doesNotMatch(consentNotices('registered-client', 'https://localhost.example/callback'), /your own device/);
  const notices = consentNotices('https://client.example/metadata.json?label=<img>', 'https://app.example/callback');
  assert.match(notices, /Client metadata domain: <strong>client.example<\/strong>/);
  assert.doesNotMatch(notices, /<img>/); assert.match(notices, /&lt;img&gt;/);
});
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
  const fetcher: typeof fetch = async (_input, init) => {
    assert.match(new URLSearchParams(String(init?.body)).get('scope')!, /read:org/);
    calls++; return Response.json({device_code: 'secret-device-code', user_code: 'ABCD', verification_uri: 'https://github.com/login/device', expires_in: 30, interval: 1});
  };
  await assert.rejects(deviceLogin('client', (url, code) => {assert.equal(code, 'ABCD'); assert.equal(url, 'https://github.com/login/device'); notified = true; controller.abort();}, controller.signal, fetcher));
  assert.equal(calls, 1); assert.ok(notified);
});

test('GitHub code exchange uses PKCE, validates scope and identity, and redacts failure details', async () => {
  const env = {ORIGIN: 'https://pkgfactory.test', GITHUB_OAUTH_CLIENT_ID: 'client', GITHUB_OAUTH_CLIENT_SECRET: 'hidden-secret'} as Env;
  const request = new Request('https://pkgfactory.test/callback?code=hidden-code&iss=https%3A%2F%2Fgithub.com%2Flogin%2Foauth');
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls.push(String(input));
    if (String(input).endsWith('/access_token')) {
      assert.equal(new Headers(init?.headers).get('User-Agent'), 'PkgFactory');
      assert.equal(init?.redirect, 'manual');
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get('code_verifier'), 'verifier'); assert.equal(body.get('redirect_uri'), env.ORIGIN + '/callback');
      return Response.json({access_token: 'hidden-token', scope: 'read:user,repo,workflow'});
    }
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer hidden-token');
    return Response.json({id: 42});
  };
  const identity = await exchangeGitHub(request, env, 'verifier', '/callback', fetcher);
  assert.equal(identity.subject, '42'); assert.equal(calls.length, 2);
  for (const [upstream, expected] of [['incorrect_client_credentials', 'oauth_client_credentials'], ['redirect_uri_mismatch', 'oauth_redirect_uri'], ['bad_verification_code', 'oauth_code_invalid'], ['hidden-token', 'oauth_exchange_rejected']]) {
    let attempts = 0;
    await assert.rejects(exchangeGitHub(request, env, 'verifier', '/callback', async () => {
      attempts++; return Response.json({error: upstream, error_description: 'hidden-secret hidden-code hidden-token'});
    }), asyncError => {
      const error = asyncError as any; assert.equal(error.code, expected);
      assert.doesNotMatch(error.message, /hidden-/); assert.doesNotMatch(error.message, /resume/); return true;
    });
    assert.equal(attempts, 1);
  }
  try {await exchangeGitHub(request, env, 'verifier', '/callback', async () => new Response('hidden-secret', {status: 502}));}
  catch (error) {const rendered = await errorResponse(error).json() as any; assert.equal(rendered.code, 'oauth_exchange_response'); assert.doesNotMatch(rendered.error, /hidden-/);}
  await assert.rejects(exchangeGitHub(request, env, 'verifier', '/callback', async () => Response.json({access_token: 'hidden-token', scope: 'read:user'})), {code: 'oauth_scopes'});
  await assert.rejects(exchangeGitHub(new Request('https://pkgfactory.test/callback?code=hidden-code&iss=https://evil.test'), env, 'verifier', '/callback', fetcher), {code: 'oauth_issuer'});
  assert.equal(calls.length, 2);
});
