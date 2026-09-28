import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { planPackage } from '../../packages/pkgfactory/src/core/plan.js';
import { encrypt } from '../../apps/cloudflare/src/auth.js';
import { sha256 } from '../../packages/pkgfactory/src/core/encoding.js';
const options = {modules: true as const, compatibilityDate: '2026-09-27', compatibilityFlags: ['enable_request_signal', 'global_fetch_strictly_public']};
test('workerd: deterministic templates, Ed25519/RSA and sealed-box without Node or Julia', async () => {
  const result = await build({entryPoints: ['test/worker/poc-worker.ts'], bundle: true, write: false, format: 'esm', platform: 'browser'});
  const mf = new Miniflare(convertV4MiniflareOptions({...options, script: result.outputFiles[0].text}));
  try {
    for (const template of ['minimum', 'simple', 'all-in-one']) {
      const spec = {owner: 'tester', name: 'Worker', authors: ['日本語 "Author"'], template};
      const fixed = {id: 'worker-test', uuid: 'd2719c3b-384b-42ad-bfb0-af5687f0c243', date: '2026-09-28T00:00:00.000Z'};
      const response = await mf.dispatchFetch('https://poc.test', {method: 'POST', body: JSON.stringify({spec, fixed})});
      assert.deepEqual(await response.json(), await planPackage(spec, fixed));
    }
    for (const algorithm of ['ed25519', 'rsa4096']) {
      const response = await mf.dispatchFetch('https://poc.test', {method: 'POST', body: JSON.stringify({key: algorithm})});
      const key = await response.json() as any; assert.ok(key.secret); assert.match(key.publicKey, /^ssh-/);
      console.log(`workerd ${algorithm}: ${key.ms} ms`);
    }
    const sodium = createRequire(import.meta.url)('libsodium-wrappers'); await sodium.ready;
    const pair = sodium.crypto_box_keypair();
    const encrypted = await (await mf.dispatchFetch('https://poc.test', {method: 'POST', body: JSON.stringify({seal: 'worker-secret', publicKey: [...pair.publicKey]})})).json() as any;
    assert.equal(sodium.crypto_box_seal_open(Buffer.from(encrypted.ciphertext, 'base64'), pair.publicKey, pair.privateKey, 'text'), 'worker-secret');
  } finally {await mf.dispose();}
});
test('Worker routes, Durable Object persistence, OAuth PKCE and CSRF rejection', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({...options, scriptPath: resolve('apps/cloudflare/dist/worker.js'),
    durableObjects: {STATE: {className: 'ApplicationState', useSQLite: true}, AUTH: {className: 'AuthState', useSQLite: true}}, kvNamespaces: ['OAUTH_KV'],
    bindings: {ORIGIN: 'https://pkgfactory.test', GITHUB_OAUTH_CLIENT_ID: 'test-client', SESSION_KEY: btoa('a'.repeat(32)), GITHUB_OAUTH_CLIENT_SECRET: 'test-secret'},
  }));
  try {
    const health = await mf.dispatchFetch('https://pkgfactory.test/health');
    assert.equal(health.status, 200); assert.equal(health.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await mf.dispatchFetch('https://evil.test/health')).status, 403);
    assert.equal((await mf.dispatchFetch('https://pkgfactory.test/api/preview', {method: 'POST', body: '{}', headers: {Origin: 'https://evil.test'}})).status, 403);
    assert.equal((await mf.dispatchFetch('https://pkgfactory.test/mcp', {method: 'POST'})).status, 401);
    const login = await mf.dispatchFetch('https://pkgfactory.test/auth/login', {redirect: 'manual'}); assert.equal(login.status, 302);
    const location = new URL(login.headers.get('location')!); assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(location.searchParams.get('code_challenge')?.length, 43);
    const bad = `https://pkgfactory.test/auth/callback?state=${location.searchParams.get('state')}&code=fake`;
    assert.equal((await mf.dispatchFetch(bad)).status, 400);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    assert.match(cookie, /__Host-pkgfactory-login=/);
    // Browser mismatch consumes the one-time state without contacting GitHub.
    assert.equal((await mf.dispatchFetch(bad, {headers: {Cookie: '__Host-pkgfactory-login=wrong'}})).status, 400);
    assert.equal((await mf.dispatchFetch(bad, {headers: {Cookie: cookie}})).status, 400);
    // Consent POST must end in a document before cross-origin navigation, so
    // Chromium's form-action 'self' does not block GitHub or the MCP callback.
    const registration = await mf.dispatchFetch('https://pkgfactory.test/oauth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({client_name: 'Acceptance', redirect_uris: ['http://127.0.0.1:12345/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code']})});
    assert.equal(registration.status, 201);
    const registered = await registration.json() as any;
    const authorize = 'https://pkgfactory.test/authorize?' + new URLSearchParams({client_id: registered.client_id, redirect_uri: 'http://127.0.0.1:12345/callback', response_type: 'code', scope: 'pkgfactory', resource: 'https://pkgfactory.test/mcp', state: 'test-state', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256'});
    for (const decision of ['approve', 'deny']) {
      const consent = await mf.dispatchFetch(authorize);
      assert.equal(consent.status, 200);
      assert.equal(consent.headers.get('referrer-policy'), 'same-origin');
      const handle = (await consent.text()).match(/name="handle" value="([^"]+)"/)![1];
      const consentCookie = consent.headers.get('set-cookie')!.split(';')[0];
      assert.equal((await mf.dispatchFetch('https://pkgfactory.test/authorize', {method: 'POST', headers: {Origin: 'null', Cookie: consentCookie, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({handle, decision}).toString()})).status, 403);
      const submit = () => mf.dispatchFetch('https://pkgfactory.test/authorize', {method: 'POST', redirect: 'manual', headers: {Origin: 'https://pkgfactory.test', Cookie: consentCookie, 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({handle, decision}).toString()});
      const next = await submit(); assert.equal(next.status, 200);
      assert.match(next.headers.get('content-security-policy')!, /form-action 'self'/);
      assert.equal(next.headers.get('location'), null);
      const navigation = await next.text(); assert.match(navigation, /http-equiv="refresh"/);
      if (decision === 'approve') {assert.match(navigation, /https:\/\/github.com\/login\/oauth\/authorize/); assert.match(navigation, /code_challenge_method=S256/);}
      else {assert.match(navigation, /http:\/\/127.0.0.1:12345\/callback/); assert.match(navigation, /error=access_denied/);}
      assert.equal((await submit()).status, 400);
    }
    const state = await mf.getDurableObjectNamespace('STATE'); const stub = state.get(state.idFromName('test'));
    const snapshot = await stub.fetch('https://state', {method: 'POST', body: JSON.stringify({action: 'snapshot'})});
    assert.deepEqual(await snapshot.json(), {revision: 0, entries: []});
    const cas = (revision: number) => stub.fetch('https://state', {method: 'POST', body: JSON.stringify({action: 'cas', revision, put: [], remove: []})});
    assert.equal((await cas(0)).status, 200); assert.equal((await cas(0)).status, 409);
    // Seed an encrypted authenticated session to exercise the production route and store.
    const authNs = await mf.getDurableObjectNamespace('AUTH'); const authStub = authNs.get(authNs.idFromName('auth-v1'));
    const sid = 's'.repeat(43), csrf = 'csrf-test'; const key = `session:${await sha256(sid)}`;
    await authStub.fetch('https://auth', {method: 'POST', body: JSON.stringify({action: 'put', key, ttl: 60000, value: await encrypt({SESSION_KEY: btoa('a'.repeat(32))}, {subject: '42', token: 'hidden', csrf}, key)})});
    const headers = {Cookie: `__Host-pkgfactory-session=${sid}`, Origin: 'https://pkgfactory.test', 'Content-Type': 'application/json', 'X-PkgFactory-CSRF': csrf};
    const preview = await mf.dispatchFetch('https://pkgfactory.test/api/preview', {method: 'POST', headers, body: JSON.stringify({owner: 'tester', name: 'Cloud', authors: ['T']})});
    assert.equal(preview.status, 200); const plan = await preview.json() as any;
    const shared = state.get(state.idFromName('pkgfactory-v1'));
    const saved = await (await shared.fetch('https://state', {method: 'POST', body: JSON.stringify({action: 'get', id: plan.id})})).json() as any;
    assert.equal(saved.subject, '42'); assert.equal(saved.plan.files['Project.toml'], plan.files['Project.toml']);
    const noCsrf = await mf.dispatchFetch('https://pkgfactory.test/api/create', {method: 'POST', headers: {...headers, 'X-PkgFactory-CSRF': 'wrong'}, body: JSON.stringify({planId: plan.id, confirm: true})}); assert.equal(noCsrf.status, 403);
    const logout = await mf.dispatchFetch('https://pkgfactory.test/auth/logout', {method: 'POST', headers, body: '{}'}); assert.equal(logout.status, 200);
    assert.equal((await mf.dispatchFetch('https://pkgfactory.test/api/templates', {headers})).status, 401);
  } finally {await mf.dispose();}
});
test('Worker executes the shared engine with durable metadata and stops after disconnect', async () => {
  const result = await build({entryPoints: ['test/worker/engine-worker.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers']});
  const mf = new Miniflare(convertV4MiniflareOptions({...options, script: result.outputFiles[0].text, durableObjects: {STATE: {className: 'ApplicationState', useSQLite: true}}}));
  try {
    const plan = await (await mf.dispatchFetch('https://engine.test/preview', {method: 'POST', body: JSON.stringify({owner: 'tester', name: 'CloudEngine', authors: ['T'], template: 'simple'})})).json() as any;
    const created = await mf.dispatchFetch('https://engine.test/create', {method: 'POST', body: JSON.stringify({planId: plan.id})});
    assert.equal(created.status, 200); assert.equal((await created.json() as any).state, 'complete');
  } finally {await mf.dispose();}
  const aborted = new Miniflare(convertV4MiniflareOptions({...options, script: result.outputFiles[0].text, durableObjects: {STATE: {className: 'ApplicationState', useSQLite: true}}, unsafeDirectSockets: [{host: '127.0.0.1', port: 0, proxy: false}]}));
  try {
    const plan = await (await aborted.dispatchFetch('https://engine.test/preview', {method: 'POST', body: JSON.stringify({owner: 'tester', name: 'Cancelled', authors: ['T']})})).json() as any;
    const controller = new AbortController();
    const direct = await aborted.unsafeGetDirectURL();
    const task = fetch(new URL('/cancel-test', direct), {method: 'POST', signal: controller.signal, body: JSON.stringify({planId: plan.id})}).then(r => r.text());
    const timer = setTimeout(() => controller.abort(), 100);
    await assert.rejects(task); clearTimeout(timer);
    await new Promise(r => setTimeout(r, 650));
    const calls = await (await aborted.dispatchFetch('https://engine.test/calls')).json() as any[];
    assert.equal(calls.filter(c => c.method === 'POST' && c.path.endsWith('/git/commits')).length, 0, JSON.stringify(calls));
  } finally {await aborted.dispose();}
});
