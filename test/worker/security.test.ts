import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { resolve } from 'node:path';
import { sessionCookieValue } from '../../apps/cloudflare/src/auth.js';
import { sha256 } from '../../packages/pkgfactory/src/core/encoding.js';
const options = {modules: true as const, compatibilityDate: '2026-09-27', compatibilityFlags: ['enable_request_signal', 'global_fetch_strictly_public'],
  durableObjects: {AUTH: {className: 'AuthState', useSQLite: true}}};
const ratelimits = (limits: Record<'SOURCE_RATE_LIMIT' | 'REGISTRATION_RATE_LIMIT' | 'ACCOUNT_RATE_LIMIT', number>) =>
  Object.fromEntries(Object.entries(limits).map(([name, limit], i) => [name, {namespace_id: String(i + 1), simple: {limit, period: 60 as const}}]));
const call = (stub: {fetch: Function}, body: unknown, path = '/') => stub.fetch(`https://state${path}`, {method: 'POST', body: JSON.stringify(body)}) as Promise<Response>;
async function stateStub(mf: Miniflare, binding = 'AUTH', name = 'auth-v1') {const ns = await mf.getDurableObjectNamespace(binding); return ns.get(ns.idFromName(name));}

test('login flood is throttled per source without exhausting sessions; parallel callbacks exchange once', async () => {
  const crypt = {SESSION_KEY: btoa('a'.repeat(32))}; let exchanges = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({...options, scriptPath: resolve('apps/cloudflare/dist/worker.js'), kvNamespaces: ['OAUTH_KV'],
    ratelimits: ratelimits({SOURCE_RATE_LIMIT: 1000, REGISTRATION_RATE_LIMIT: 1000, ACCOUNT_RATE_LIMIT: 1000}),
    bindings: {...crypt, ORIGIN: 'https://pkgfactory.test', GITHUB_OAUTH_CLIENT_ID: 'test', GITHUB_OAUTH_CLIENT_SECRET: 'secret'},
    outboundService: async (request: any) => {
      if (request.url === 'https://github.com/login/oauth/access_token') {exchanges++; return Response.json({access_token: 'test', scope: 'repo,workflow'});}
      assert.equal(request.url, 'https://api.github.com/user'); return Response.json({id: 42, login: 'tester'});
    },
  }));
  try {
    const auth = await stateStub(mf);
    const env = {...crypt, ORIGIN: 'https://pkgfactory.test'};
    let login!: Response;
    for (let i = 0; i < 21; i++) {
      login = await mf.dispatchFetch('https://pkgfactory.test/auth/login', {redirect: 'manual', headers: {'CF-Connecting-IP': '192.0.2.1'}}) as unknown as Response;
      assert.equal(login.status, i < 20 ? 302 : 429);
      if (i < 20) {
        const state = new URL(login.headers.get('location')!).searchParams.get('state');
        assert.equal(await (await call(auth, {action: 'get', key: `pending:${await sha256(state!)}`})).json(), null, 'No anonymous pending record is allocated');
      }
    }
    assert.equal(login.headers.get('retry-after'), '60');
    for (let i = 1; i <= 21; i++) {
      const rotated = await mf.dispatchFetch('https://pkgfactory.test/auth/login', {redirect: 'manual', headers: {'CF-Connecting-IP': `2001:db8:1:2::${i.toString(16)}`}});
      assert.equal(rotated.status, i <= 20 ? 302 : 429, 'Rotating IPv6 within a /64 must not reset the limit');
    }
    const prefix = await mf.dispatchFetch('https://pkgfactory.test/auth/login', {redirect: 'manual', headers: {'CF-Connecting-IP': '2001:db8:1:3::1'}});
    assert.equal(prefix.status, 302, 'A different /64 has its own limit');
    const mapped = await mf.dispatchFetch('https://pkgfactory.test/auth/login', {redirect: 'manual', headers: {'CF-Connecting-IP': '::ffff:192.0.2.1'}});
    assert.equal(mapped.status, 429, 'Mapped IPv4 shares the IPv4 limit');
    const headers = {Cookie: `__Host-pkgfactory-session=${await sessionCookieValue(env, {id: 's'.repeat(43), subject: '42', token: 'test', csrf: 'test', expiresAt: Date.now() + 60000})}`};
    assert.equal((await mf.dispatchFetch('https://pkgfactory.test/api/templates', {headers})).status, 200);
    const fresh = await mf.dispatchFetch('https://pkgfactory.test/auth/login', {redirect: 'manual', headers: {'CF-Connecting-IP': '192.0.2.2'}});
    assert.equal(fresh.status, 302);
    const url = 'https://pkgfactory.test/auth/callback?' + new URLSearchParams({state: new URL(fresh.headers.get('location')!).searchParams.get('state')!, code: 'valid'});
    const cookie = fresh.headers.get('set-cookie')!.split(';')[0];
    // A valid but different browser cookie and tampered ciphertext cannot consume it.
    const other = await mf.dispatchFetch('https://pkgfactory.test/auth/login', {redirect: 'manual', headers: {'CF-Connecting-IP': '192.0.2.2'}});
    assert.equal((await mf.dispatchFetch(url, {redirect: 'manual', headers: {Cookie: other.headers.get('set-cookie')!.split(';')[0]}})).status, 400);
    assert.equal((await mf.dispatchFetch(url, {redirect: 'manual', headers: {Cookie: cookie.slice(0, -5) + 'AAAAA'}})).status, 400);
    const replies = await Promise.all([1, 2].map(() => mf.dispatchFetch(url, {redirect: 'manual', headers: {Cookie: cookie}})));
    assert.deepEqual(replies.map(r => r.status).sort(), [302, 400]); assert.equal(exchanges, 1);
    const success = replies.find(r => r.status === 302)!;
    const sessionCookie = success.headers.getSetCookie().find(c => c.startsWith('__Host-pkgfactory-session='))!.split(';')[0];
    assert.equal((await mf.dispatchFetch('https://pkgfactory.test/api/templates', {headers: {Cookie: sessionCookie}})).status, 200);
  } finally {await mf.dispose();}
});

test('anonymous OAuth writes are limited per source and API use per GitHub account', async () => {
  const crypt = {SESSION_KEY: btoa('a'.repeat(32))};
  const mf = new Miniflare(convertV4MiniflareOptions({...options, scriptPath: resolve('apps/cloudflare/dist/worker.js'), kvNamespaces: ['OAUTH_KV'],
    ratelimits: ratelimits({SOURCE_RATE_LIMIT: 6, REGISTRATION_RATE_LIMIT: 2, ACCOUNT_RATE_LIMIT: 3}),
    bindings: {...crypt, ORIGIN: 'https://pkgfactory.test', GITHUB_OAUTH_CLIENT_ID: 'test', GITHUB_OAUTH_CLIENT_SECRET: 'secret'},
  }));
  try {
    const register = (ip: string) => mf.dispatchFetch('https://pkgfactory.test/oauth/register', {method: 'POST', headers: {'CF-Connecting-IP': ip, 'Content-Type': 'application/json'},
      body: JSON.stringify({client_name: 'Flood', redirect_uris: ['http://127.0.0.1:1/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code'], response_types: ['code']})});
    for (const expected of [201, 201, 429]) assert.equal((await register('192.0.2.10')).status, expected);
    const refused = await register('192.0.2.10');
    assert.equal(refused.headers.get('retry-after'), '60'); assert.equal((await refused.json() as any).error, 'temporarily_unavailable');
    assert.equal((await register('192.0.2.11')).status, 201, 'Another source keeps its own registration limit');
    // Every anonymous OAuth route from one source shares one counter.
    const token = () => mf.dispatchFetch('https://pkgfactory.test/oauth/token', {method: 'POST', headers: {'CF-Connecting-IP': '192.0.2.20', 'Content-Type': 'application/x-www-form-urlencoded'}, body: 'grant_type=authorization_code&code=invalid'});
    for (let i = 0; i < 6; i++) assert.notEqual((await token()).status, 429);
    assert.equal((await token()).status, 429);
    assert.equal((await mf.dispatchFetch('https://pkgfactory.test/auth/login', {redirect: 'manual', headers: {'CF-Connecting-IP': '192.0.2.20'}})).status, 429);
    assert.equal((await mf.dispatchFetch('https://pkgfactory.test/health', {headers: {'CF-Connecting-IP': '192.0.2.20'}})).status, 200);
    // Signed-in API calls count per GitHub account, so users behind one address stay independent.
    const signIn = async (subject: string) => ({Cookie: `__Host-pkgfactory-session=${await sessionCookieValue({...crypt, ORIGIN: 'https://pkgfactory.test'},
      {id: subject.repeat(43).slice(0, 43), subject, token: 'test', csrf: 'test', expiresAt: Date.now() + 60000})}`, 'CF-Connecting-IP': '192.0.2.30'});
    const first = await signIn('4'), second = await signIn('5');
    for (const expected of [200, 200, 200, 429]) assert.equal((await mf.dispatchFetch('https://pkgfactory.test/api/templates', {headers: first})).status, expected);
    assert.equal((await mf.dispatchFetch('https://pkgfactory.test/api/templates', {headers: second})).status, 200);
    // Suggestions must pass the shared account limiter before any inference,
    // including when the AI binding is unavailable.
    const suggest = (headers: Record<string, string>) => mf.dispatchFetch('https://pkgfactory.test/api/template-suggestion', {method: 'POST',
      headers: {...headers, Origin: 'https://pkgfactory.test', 'Content-Type': 'application/json', 'X-PkgFactory-CSRF': 'test'},
      body: JSON.stringify({description: 'Scientific computing'})});
    assert.equal((await suggest(first)).status, 429);
    assert.equal((await suggest(second)).status, 503, 'Another account reaches the AI availability check');
    assert.equal((await mf.dispatchFetch('https://pkgfactory.test/api/templates', {headers: second})).status, 200);
    assert.equal((await mf.dispatchFetch('https://pkgfactory.test/api/templates', {headers: second})).status, 429, 'Suggestions consume the shared API quota');
  } finally {await mf.dispose();}
});

test('a SESSION_KEY that is not 32 bytes refuses every route except /health', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({...options, scriptPath: resolve('apps/cloudflare/dist/worker.js'), kvNamespaces: ['OAUTH_KV'],
    ratelimits: ratelimits({SOURCE_RATE_LIMIT: 1000, REGISTRATION_RATE_LIMIT: 1000, ACCOUNT_RATE_LIMIT: 1000}),
    // A 24-byte key still encrypts with AES-GCM, so the Worker must reject it before any route runs.
    bindings: {SESSION_KEY: btoa('a'.repeat(24)), ORIGIN: 'https://pkgfactory.test', GITHUB_OAUTH_CLIENT_ID: 'test', GITHUB_OAUTH_CLIENT_SECRET: 'secret'},
  }));
  try {
    assert.equal((await mf.dispatchFetch('https://pkgfactory.test/health')).status, 200);
    for (const path of ['/', '/auth/login', '/api/templates', '/mcp', '/oauth/register']) {
      const response = await mf.dispatchFetch('https://pkgfactory.test' + path, {redirect: 'manual'});
      assert.equal(response.status, 503, path);
      assert.equal((await response.json() as any).error, 'SESSION_KEY must be 32 bytes of Base64');
    }
  } finally {await mf.dispose();}
});
