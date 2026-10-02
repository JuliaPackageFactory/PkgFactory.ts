import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encrypt, decrypt, exchangeGitHub, revokeGitHub, sessionKeyValid, type Env } from '../apps/cloudflare/src/auth.js';
import { errorResponse } from '../packages/pkgfactory/src/web/http.js';
import { deviceLogin } from '../packages/pkgfactory/src/github/device.js';
import { consentNotices, redirectAllowed, registrationPolicy } from '../apps/cloudflare/src/consent.js';
import { loginSource } from '../apps/cloudflare/src/ip.js';

test('login source groups IPv6 by /64 and canonicalizes IPv4-mapped aliases', () => {
  assert.equal(loginSource('2001:db8:1:2::1'), loginSource('2001:0DB8:0001:0002:ffff:ffff:ffff:ffff'));
  assert.notEqual(loginSource('2001:db8:1:2::1'), loginSource('2001:db8:1:3::1'));
  assert.equal(loginSource('::ffff:192.0.2.1'), loginSource('::FFFF:c000:201'));
  assert.equal(loginSource('::ffff:192.0.2.1'), loginSource('192.0.2.1'));
  assert.notEqual(loginSource('192.0.2.1'), loginSource('192.0.2.2'));
  for (const bad of [null, 'garbage', '2001:db8:::1', '::1%eth0', '192.0.2.999']) assert.equal(loginSource(bad), 'unknown');
});

test('consent identifies loopback redirects and the actual CIMD domain', () => {
  for (const address of ['http://localhost:3000/callback', 'http://127.0.0.2:3000/callback', 'http://[::1]:3000/callback', 'http://localhost.:3000/callback', 'http://app.localhost.:3000/callback', 'http://0.0.0.0/callback', 'http://[::]/callback', 'http://[::ffff:7f00:1]/callback', 'http://[::ffff:127.0.0.2]/callback']) assert.match(consentNotices('registered-client', address), /your own device/, address);
  assert.doesNotMatch(consentNotices('registered-client', 'https://localhost.example/callback'), /your own device/);
  assert.match(consentNotices('registered-client', 'cursor://client/callback'), /Native application/);
  assert.match(consentNotices('HTTPS://client.example/metadata.json', 'https://app.example/callback'), /<strong>client.example<\/strong>/);
  const notices = consentNotices('https://client.example/metadata.json?label=<img>', 'https://app.example/callback');
  assert.match(notices, /Client metadata domain: <strong>client.example<\/strong>/);
  assert.doesNotMatch(notices, /<img>/); assert.match(notices, /&lt;img&gt;/);
});
test('plain HTTP return addresses are limited to the user device at registration and consent', () => {
  for (const allowed of ['https://claude.ai/api/mcp/auth_callback', 'http://127.0.0.1:12345/callback', 'http://localhost:3000/callback', 'http://[::1]:3000/callback', 'cursor://client/callback', 'vscode://client/callback']) assert.equal(redirectAllowed(allowed), true, allowed);
  for (const rejected of ['http://remote.example/callback', 'http://localhost.example/callback', 'http://192.0.2.1/callback', 'not a url']) assert.equal(redirectAllowed(rejected), false, rejected);
  const request = new Request('https://pkgfactory.test/oauth/register', {method: 'POST'});
  assert.equal(registrationPolicy({clientMetadata: {redirect_uris: ['http://127.0.0.1:1/callback', 'https://app.example/callback']}, request}), undefined);
  assert.match(registrationPolicy({clientMetadata: {redirect_uris: ['https://app.example/callback', 'http://remote.example/callback']}, request})!.description!, /HTTPS, loopback/);
});
test('logout revocation authenticates as the OAuth App and keeps the token out of the URL', async () => {
  const env = {GITHUB_OAUTH_CLIENT_ID: 'client', GITHUB_OAUTH_CLIENT_SECRET: 'hidden-secret'};
  let seen: {url: string; init?: RequestInit} | undefined;
  assert.equal(await revokeGitHub(env, 'hidden-token', async (input, init) => {seen = {url: String(input), init}; return new Response(null, {status: 204});}), true);
  assert.equal(seen!.url, 'https://api.github.com/applications/client/token'); assert.doesNotMatch(seen!.url, /hidden/);
  assert.equal(seen!.init?.method, 'DELETE'); assert.equal(seen!.init?.redirect, 'manual');
  assert.equal(new Headers(seen!.init?.headers).get('Authorization'), `Basic ${btoa('client:hidden-secret')}`);
  assert.deepEqual(JSON.parse(String(seen!.init?.body)), {access_token: 'hidden-token'});
  // Already expired/revoked tokens, redirects and outages never block logout.
  for (const status of [404, 422, 302, 500]) assert.equal(await revokeGitHub(env, 'hidden-token', async () => new Response(null, {status})), false);
  assert.equal(await revokeGitHub(env, 'hidden-token', async () => {throw new TypeError('network');}), false);
});
test('session ciphertext is authenticated and bound to its server-side identifier', async () => {
  const env = {SESSION_KEY: btoa('s'.repeat(32))}; const session = {token: 'never-log', subject: '42'};
  const encrypted = await encrypt(env, session, 'session:one');
  assert.equal(JSON.stringify(encrypted).includes(session.token), false);
  assert.deepEqual(await decrypt(env, encrypted, 'session:one'), session);
  await assert.rejects(decrypt(env, encrypted, 'session:two'));
  await assert.rejects(decrypt({SESSION_KEY: btoa('x'.repeat(32))}, encrypted, 'session:one'));
});
test('SESSION_KEY must decode to exactly 32 bytes', () => {
  assert.equal(sessionKeyValid(btoa('k'.repeat(32))), true);
  // Shorter AES keys would still encrypt; a typo or truncated paste must not run as a weaker key.
  for (const bad of [undefined, '', btoa('k'.repeat(16)), btoa('k'.repeat(24)), btoa('k'.repeat(31)), btoa('k'.repeat(33)), 'not base64!', 'k'.repeat(32)]) assert.equal(sessionKeyValid(bad), false, String(bad));
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
