import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { planPackage } from '../../packages/pkgfactory/src/core/plan.js';
import { encrypt, decrypt } from '../../apps/cloudflare/src/auth.js';
import { sha256, base64url, unbase64url, decode, utf8 } from '../../packages/pkgfactory/src/core/encoding.js';
import { FakeGitHub } from '../fake-github.js';
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
  const remote = new FakeGitHub();
  const mf = new Miniflare(convertV4MiniflareOptions({...options, scriptPath: resolve('apps/cloudflare/dist/worker.js'),
    durableObjects: {STATE: {className: 'ApplicationState', useSQLite: true}, AUTH: {className: 'AuthState', useSQLite: true}}, kvNamespaces: ['OAUTH_KV'],
    bindings: {ORIGIN: 'https://pkgfactory.test', GITHUB_OAUTH_CLIENT_ID: 'test-client', SESSION_KEY: btoa('a'.repeat(32)), GITHUB_OAUTH_CLIENT_SECRET: 'test-secret'},
    outboundService: async (request: any) => remote.fetch(request.url, {method: request.method}),
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
    assert.match(location.searchParams.get('scope')!, /read:org/);
    const bad = `https://pkgfactory.test/auth/callback?state=${location.searchParams.get('state')}&code=fake`;
    assert.equal((await mf.dispatchFetch(bad)).status, 400);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    assert.match(cookie, /__Host-pkgfactory-login=/);
    // A wrong browser must not consume a legitimate browser's state.
    assert.equal((await mf.dispatchFetch(bad, {headers: {Cookie: '__Host-pkgfactory-login=wrong'}})).status, 400);
    assert.equal((await mf.dispatchFetch(bad, {headers: {Cookie: cookie}})).status, 502);
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
      const consentHtml = await consent.text(); assert.match(consentHtml, /Local application/);
      const handle = consentHtml.match(/name="handle" value="([^"]+)"/)![1];
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
    const snapshot = await stub.fetch('https://state', {method: 'POST', body: JSON.stringify({action: 'snapshot', subject: '42'})});
    assert.deepEqual(await snapshot.json(), {revision: 0, entries: []});
    const cas = (revision: number) => stub.fetch('https://state', {method: 'POST', body: JSON.stringify({action: 'cas', subject: '42', revision, put: [], remove: []})});
    assert.equal((await cas(0)).status, 200); assert.equal((await cas(0)).status, 409);
    // Seed an encrypted authenticated session to exercise the production route and store.
    const authNs = await mf.getDurableObjectNamespace('AUTH'); const authStub = authNs.get(authNs.idFromName('auth-v1'));
    const sid = 's'.repeat(43), csrf = 'csrf-test'; const key = `session:${await sha256(sid)}`;
    await authStub.fetch('https://auth', {method: 'POST', body: JSON.stringify({action: 'put', key, ttl: 60000, value: await encrypt({SESSION_KEY: btoa('a'.repeat(32))}, {subject: '42', token: 'hidden', csrf}, key)})});
    const headers = {Cookie: `__Host-pkgfactory-session=${sid}`, Origin: 'https://pkgfactory.test', 'Content-Type': 'application/json', 'X-PkgFactory-CSRF': csrf};
    const suggest = (overrides: Record<string, string> = {}) => mf.dispatchFetch('https://pkgfactory.test/api/template-suggestion', {method: 'POST', headers: {...headers, ...overrides}, body: JSON.stringify({description: 'Scientific computing'})});
    assert.equal((await suggest({Cookie: ''})).status, 401);
    assert.equal((await suggest({'X-PkgFactory-CSRF': 'wrong'})).status, 403);
    assert.equal((await suggest({Origin: 'https://evil.test'})).status, 403);
    const unavailable = await suggest(); assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json() as any).code, 'suggestion_unavailable');
    const preview = await mf.dispatchFetch('https://pkgfactory.test/api/preview', {method: 'POST', headers, body: JSON.stringify({owner: 'tester', name: 'Cloud', authors: ['T']})});
    assert.equal(preview.status, 200); const plan = await preview.json() as any;
    const shared = state.get(state.idFromName('pkgfactory-v1'));
    const saved = await (await shared.fetch('https://state', {method: 'POST', body: JSON.stringify({action: 'get', subject: '42', id: plan.id})})).json() as any;
    assert.equal(saved.subject, '42'); assert.equal(saved.plan.files['Project.toml'], plan.files['Project.toml']);
    const replacement = await mf.dispatchFetch('https://pkgfactory.test/api/preview', {method: 'POST', headers, body: JSON.stringify({...plan.spec, description: 'Edited', replacePlanId: plan.id})});
    assert.equal(replacement.status, 200); const updated = await replacement.json() as any;
    assert.equal(await (await shared.fetch('https://state', {method: 'POST', body: JSON.stringify({action: 'get', subject: '42', id: plan.id})})).json(), null);
    const after = await (await shared.fetch('https://state', {method: 'POST', body: JSON.stringify({action: 'snapshot', subject: '42'})})).json() as any;
    assert.equal(after.entries.length, 1); assert.equal(after.entries[0][0], updated.id);
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

test('Worker native fetch completes Web/MCP OAuth and 3 templates without following redirects', async () => {
  const calls: string[] = [];
  let remote = new FakeGitHub();
  const mf = new Miniflare(convertV4MiniflareOptions({...options, scriptPath: resolve('apps/cloudflare/dist/worker.js'),
    durableObjects: {STATE: {className: 'ApplicationState', useSQLite: true}, AUTH: {className: 'AuthState', useSQLite: true}}, kvNamespaces: ['OAUTH_KV'],
    bindings: {ORIGIN: 'https://pkgfactory.test', GITHUB_OAUTH_CLIENT_ID: 'test-client', SESSION_KEY: btoa('a'.repeat(32)), GITHUB_OAUTH_CLIENT_SECRET: 'test-secret'},
    // Intercept only after workerd's native Request/fetch validates its options.
    // Replacing fetch inside the application would hide runtime incompatibilities.
    outboundService: async (request: any) => {
      calls.push(request.url);
      assert.equal(request.headers.get('User-Agent'), 'PkgFactory');
      if (request.url === 'https://github.com/login/oauth/access_token') {
        assert.equal(request.method, 'POST');
        const body = new URLSearchParams(await request.text());
        assert.equal(body.get('client_secret'), 'test-secret');
        assert.equal(body.get('code_verifier')?.length, 43);
        if (body.get('code') === 'expired-code') return Response.json({error: 'bad_verification_code'});
        if (body.get('code') === 'redirect-token') return new Response(null, {status: 307, headers: {Location: 'https://unexpected.test/token'}});
        return Response.json({access_token: body.get('code') === 'redirect-user' ? 'redirect-user' : 'test-token', scope: 'repo,workflow,read:user'});
      }
      assert.equal(new URL(request.url).origin, 'https://api.github.com');
      if (request.headers.get('Authorization') === 'Bearer redirect-user') return new Response(null, {status: 302, headers: {Location: 'https://unexpected.test/user'}});
      assert.equal(request.headers.get('Authorization'), 'Bearer test-token');
      return remote.fetch(request.url, {method: request.method, body: request.method === 'GET' ? undefined : await request.text()});
    },
  }));
  const signIn = async (code: string) => {
    const start = await mf.dispatchFetch('https://pkgfactory.test/auth/login', {redirect: 'manual'});
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!;
    return mf.dispatchFetch(`https://pkgfactory.test/auth/callback?state=${state}&code=${code}`, {redirect: 'manual', headers: {Cookie: start.headers.get('set-cookie')!.split(';')[0]}});
  };
  try {
    const success = await signIn('valid');
    assert.equal(success.status, 302, await success.text());
    assert.equal(success.headers.get('location'), 'https://pkgfactory.test/');
    assert.match(success.headers.get('set-cookie')!, /__Host-pkgfactory-session=/);
    assert.equal(calls.length, 2);
    const redirectedToken = await signIn('redirect-token');
    assert.equal((await redirectedToken.json() as any).code, 'oauth_exchange_redirect');
    assert.equal(calls.length, 3);
    const redirectedUser = await signIn('redirect-user');
    assert.equal((await redirectedUser.json() as any).code, 'oauth_identity_request');
    assert.equal(calls.length, 5);
    assert(calls.every(url => !url.startsWith('https://unexpected.test')));

    const expiredCode = await signIn('expired-code');
    assert.equal(expiredCode.status, 400);
    assert.equal((await expiredCode.json() as any).code, 'oauth_code_invalid');
    assert.equal(calls.length, 6);
    const expiring = await mf.dispatchFetch('https://pkgfactory.test/auth/login', {redirect: 'manual'});
    const expiringState = new URL(expiring.headers.get('location')!).searchParams.get('state')!;
    const context = 'web-login:https://pkgfactory.test', crypt = {SESSION_KEY: btoa('a'.repeat(32))};
    const encryptedCookie = expiring.headers.get('set-cookie')!.split(';')[0].split('=')[1];
    const pending = await decrypt(crypt, JSON.parse(decode(unbase64url(encryptedCookie))), context);
    // Re-encrypt a past deadline using only this test's key; no wall-clock sleep.
    const expiredCookie = base64url(utf8(JSON.stringify(await encrypt(crypt, {...pending, expiresAt: Date.now() - 1}, context))));
    const expiredState = await mf.dispatchFetch(`https://pkgfactory.test/auth/callback?state=${expiringState}&code=valid`, {headers: {Cookie: `__Host-pkgfactory-login=${expiredCookie}`}});
    assert.equal(expiredState.status, 400); assert.match((await expiredState.json() as any).error, /Expired OAuth state/);
    assert.equal(calls.length, 6, 'Expired state must stop before contacting GitHub');

    const cookie = success.headers.getSetCookie().find(c => c.startsWith('__Host-pkgfactory-session='))!.split(';')[0];
    const page = await (await mf.dispatchFetch('https://pkgfactory.test/', {headers: {Cookie: cookie}})).text();
    const csrf = page.match(/name="csrf-token" content="([^"]+)"/)![1];
    const profile = await (await mf.dispatchFetch('https://pkgfactory.test/api/github/profile', {headers: {Cookie: cookie}})).json() as any;
    assert.equal(profile.user.name, 'Test Author'); assert.equal(profile.owners[0].login, 'tester');
    const post = async (path: string, body: unknown) => (await mf.dispatchFetch(`https://pkgfactory.test/api/${path}`, {method: 'POST', headers: {Cookie: cookie, Origin: 'https://pkgfactory.test', 'X-PkgFactory-CSRF': csrf, 'Content-Type': 'application/json'}, body: JSON.stringify(body)})).json() as Promise<any>;
    for (const [i, template] of ['minimum', 'simple', 'all-in-one'].entries()) {
      remote = new FakeGitHub();
      const plan = await post('preview', {owner: 'tester', name: `Native${i}`, authors: ['Tester'], template});
      const result = await post('create', {planId: plan.id, confirm: true});
      assert.equal(result.state, 'complete', JSON.stringify(result));
      assert(remote.files['Project.toml']);
      if (template !== 'minimum') {assert(remote.secret); assert(remote.pages); assert.match(remote.keys[0].key, /^ssh-ed25519 /);}
    }

    const registration = await mf.dispatchFetch('https://pkgfactory.test/oauth/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({client_name: 'Native acceptance', redirect_uris: ['http://127.0.0.1:12345/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code']})});
    const registered = await registration.json() as any;
    const verifier = 'v'.repeat(43), challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(verifier))));
    const consent = await mf.dispatchFetch('https://pkgfactory.test/authorize?' + new URLSearchParams({client_id: registered.client_id, redirect_uri: 'http://127.0.0.1:12345/callback', response_type: 'code', scope: 'pkgfactory', resource: 'https://pkgfactory.test/mcp', state: 'native-state', code_challenge: challenge, code_challenge_method: 'S256'}));
    const handle = (await consent.text()).match(/name="handle" value="([^"]+)"/)![1];
    const approved = await mf.dispatchFetch('https://pkgfactory.test/authorize', {method: 'POST', headers: {Origin: 'https://pkgfactory.test', Cookie: consent.headers.get('set-cookie')!.split(';')[0], 'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({handle, decision: 'approve'}).toString()});
    const navigation = await approved.text();
    const upstream = new URL(navigation.match(/href="([^"]+)"/)![1].replaceAll('&amp;', '&'));
    const upstreamCookie = approved.headers.getSetCookie().filter(c => c.startsWith('__Host-oauth-upstream-')).map(c => c.split(';')[0]).join('; ');
    const finished = await mf.dispatchFetch(`https://pkgfactory.test/callback?code=valid&state=${upstream.searchParams.get('state')}`, {redirect: 'manual', headers: {Cookie: upstreamCookie}});
    assert.equal(finished.status, 302, await finished.text());
    const callback = new URL(finished.headers.get('location')!); assert.equal(callback.searchParams.get('state'), 'native-state');
    const token = await mf.dispatchFetch('https://pkgfactory.test/oauth/token', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({grant_type: 'authorization_code', code: callback.searchParams.get('code')!, client_id: registered.client_id, redirect_uri: 'http://127.0.0.1:12345/callback', code_verifier: verifier, resource: 'https://pkgfactory.test/mcp'}).toString()});
    assert.equal(token.status, 200); const credential = await token.json() as any;
    const initialized = await mf.dispatchFetch('https://pkgfactory.test/mcp', {method: 'POST', headers: {Authorization: `Bearer ${credential.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'test', version: '1'}}})});
    assert.equal(initialized.status, 200); assert.equal((await initialized.json() as any).result.serverInfo.name, 'PkgFactory');
  } finally {await mf.dispose();}
});
