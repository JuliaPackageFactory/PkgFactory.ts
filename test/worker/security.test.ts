import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { resolve } from 'node:path';
import { planPackage } from '../../packages/pkgfactory/src/core/plan.js';
import { encrypt, sessionCookieValue } from '../../apps/cloudflare/src/auth.js';
import { sha256 } from '../../packages/pkgfactory/src/core/encoding.js';
import type { Operation } from '../../packages/pkgfactory/src/application/state.js';
const options = {modules: true as const, compatibilityDate: '2026-09-27', compatibilityFlags: ['enable_request_signal', 'global_fetch_strictly_public'],
  durableObjects: {STATE: {className: 'ApplicationState', useSQLite: true}, AUTH: {className: 'AuthState', useSQLite: true}}};
const ratelimits = (limits: Record<'SOURCE_RATE_LIMIT' | 'REGISTRATION_RATE_LIMIT' | 'ACCOUNT_RATE_LIMIT', number>) =>
  Object.fromEntries(Object.entries(limits).map(([name, limit], i) => [name, {namespace_id: String(i + 1), simple: {limit, period: 60 as const}}]));
const diagnostics = async () => (await build({entryPoints: ['test/worker/security-worker.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers']})).outputFiles[0].text;
const call = (stub: {fetch: Function}, body: unknown, path = '/') => stub.fetch(`https://state${path}`, {method: 'POST', body: JSON.stringify(body)}) as Promise<Response>;
async function stateStub(mf: Miniflare, binding = 'STATE', name = 'pkgfactory-v1') {const ns = await mf.getDurableObjectNamespace(binding); return ns.get(ns.idFromName(name));}
const legacyScript = `import {DurableObject} from 'cloudflare:workers';
  export class ApplicationState extends DurableObject {async fetch(request) {
    const entries = Object.entries(await request.json());
    for (let i=0; i<entries.length; i+=128) await this.ctx.storage.put(Object.fromEntries(entries.slice(i,i+128)));
    return Response.json({ok:true});
  }}
  export class AuthState extends ApplicationState {}
  export default {fetch() {return Response.json({ok:true})}};`;

test('indexed plans isolate account capacity and retain cross-account repository/concurrency locks', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({...options, script: await diagnostics()}));
  const engine = (path: string, body: unknown) => mf.dispatchFetch('https://test' + path, {method: 'POST', body: JSON.stringify(body)});
  try {
    assert.equal((await engine('/fill', {subject: 'unused'})).status, 200);
    const stub = await stateStub(mf);
    assert.equal((await (await call(stub, {}, '/stats')).json() as any).count, 272);
    assert.equal((await engine('/preview', {subject: 'user-0'})).status, 429, 'Per-account limit remains 16');
    const own = await (await call(stub, {action: 'snapshot', subject: 'user-0'})).json() as any;
    assert.equal(own.entries.length, 16, 'Snapshots must not return every account');
    // Expired unfinished work must not vanish or use another account\'s quota.
    const interrupted = own.entries.map(([, op]: [string, Operation]) => ({...op, state: 'paused', expiresAt: 0, leaseUntil: 0, pending: {stage: 'repository', method: 'POST', path: '/user/repos', startedAt: 1}}));
    assert.equal((await call(stub, {action: 'put', subject: 'user-0', put: interrupted})).status, 200);
    await call(stub, {}, '/expire');
    assert.equal((await engine('/preview', {subject: 'user-0'})).status, 429);
    const preview = await engine('/preview', {subject: '42'}); assert.equal(preview.status, 200);
    const plan = await preview.json() as any;
    assert.equal(await (await call(stub, {action: 'get', subject: 'other', id: plan.id})).json(), null);
    const locked = await engine('/create', {subject: '42', planId: plan.id});
    assert.equal(locked.status, 409); assert.match((await locked.json() as any).error, /repository lock/);
    assert.equal((await (await mf.dispatchFetch('https://test/calls')).json() as any[]).filter(c => c.method !== 'GET').length, 0);
    // Eight active leases on unrelated repositories still enforce the global execution bound.
    const busy = own.entries.slice(0, 8).map(([, op]: [string, Operation], i: number) => ({...op, plan: {...op.plan, repository: `tester/Busy${i}.jl`}, state: 'running', leaseUntil: Date.now() + 60000}));
    await call(stub, {action: 'put', subject: 'user-0', put: busy});
    const unlocked = await (await engine('/preview', {subject: '42', name: 'Different'})).json() as any;
    const blocked = await engine('/create', {subject: '42', planId: unlocked.id}); assert.equal(blocked.status, 429);
    assert.match((await blocked.json() as any).error, /concurrent/);
    const bounded = await (await call(stub, {action: 'snapshot', subject: '42', lock: {repository: unlocked.repository, now: Date.now()}})).json() as any;
    assert.equal(bounded.entries.length, 10, 'Only two own plans and eight relevant active leases are read');
  } finally {await mf.dispose();}
});

test('storage upgrade preserves legacy sessions, immutable plans and unresolved writes across restart', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({...options, script: legacyScript}));
  try {
    const plan = await planPackage({owner: 'tester', name: 'Migrated', authors: ['Tester'], template: 'minimum'});
    const operations = Array.from({length: 130}, (_, i) => ({subject: i === 0 ? '42' : `user-${i}`, plan: {...plan, id: i === 0 ? plan.id : crypto.randomUUID()}, state: i === 0 ? 'paused' : 'running', expiresAt: 0, leaseUntil: 1,
      pending: {stage: 'repository', method: 'POST', path: '/user/repos', startedAt: 1}, error: 'Unknown outcome'} as Operation));
    const legacy: Record<string, unknown> = {revision: 7, operations: operations.map(op => [op.plan.id, {...op, plan: {id: op.plan.id, digest: op.plan.digest, repository: op.plan.repository}}])};
    for (const op of operations) legacy[`plan:${op.plan.id}`] = op.plan;
    await call(await stateStub(mf), legacy);
    const sid = 's'.repeat(43), key = `session:${await sha256(sid)}`;
    const session = await encrypt({SESSION_KEY: btoa('a'.repeat(32))}, {subject: '42', token: 'hidden', csrf: 'test'}, key);
    await call(await stateStub(mf, 'AUTH', 'auth-v1'), {[key]: {value: session, expiresAt: Date.now() + 60000},
      ...Object.fromEntries(Array.from({length: 130}, (_, i) => [`pending:${i}`, {value: i, expiresAt: 1}]))});
    const script = await diagnostics(); await mf.setOptions(convertV4MiniflareOptions({...options, script}));
    let state = await stateStub(mf), auth = await stateStub(mf, 'AUTH', 'auth-v1');
    assert.deepEqual(await (await call(state, {action: 'get', subject: '42', id: plan.id})).json(), operations[0]);
    assert.deepEqual(await (await call(auth, {action: 'get', key})).json(), session);
    assert.deepEqual(await (await call(state, {}, '/stats')).json(), {count: 130, legacy: []});
    assert.deepEqual(await (await call(auth, {}, '/stats')).json(), {count: 1, legacy: ['migrated-v2']});
    await call(state, {}, '/expire');
    assert.equal((await (await call(state, {}, '/stats')).json() as any).count, 130, 'Expired unresolved writes are retained');
    await mf.setOptions(convertV4MiniflareOptions({...options, script: script + '\n// restart'}));
    state = await stateStub(mf); auth = await stateStub(mf, 'AUTH', 'auth-v1');
    assert.deepEqual(await (await call(state, {action: 'get', subject: '42', id: plan.id})).json(), operations[0]);
    assert.deepEqual(await (await call(auth, {action: 'get', key})).json(), session);
  } finally {await mf.dispose();}
});

test('a missing legacy plan is isolated while healthy plans work and its repository lock survives', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({...options, script: legacyScript}));
  try {
    const healthy = await planPackage({owner: 'tester', name: 'Healthy', authors: ['Tester'], template: 'minimum'});
    const missing = await planPackage({owner: 'tester', name: 'Missing', authors: ['Tester'], template: 'minimum'});
    const op: Operation = {plan: healthy, subject: '42', state: 'preview', expiresAt: Date.now() + 60000};
    const damaged: Operation = {plan: {id: missing.id, digest: missing.digest, repository: missing.repository} as Operation['plan'], subject: '99', state: 'paused', expiresAt: 1, leaseUntil: 1,
      pending: {stage: 'repository', method: 'POST', path: '/user/repos', startedAt: 1}};
    // Include an expired, never-executed corrupt preview to test both cleanup paths.
    const damagedPreview = {...damaged, plan: {...damaged.plan, id: crypto.randomUUID()}, state: 'preview', subject: '42'};
    await call(await stateStub(mf), {operations: [[healthy.id, op], [missing.id, damaged], [damagedPreview.plan.id, damagedPreview]], [`plan:${healthy.id}`]: healthy});
    const script = await diagnostics(); await mf.setOptions(convertV4MiniflareOptions({...options, script}));
    const engine = (path: string, body: unknown) => mf.dispatchFetch('https://test' + path, {method: 'POST', body: JSON.stringify(body)});
    const blocked = await engine('/create', {subject: '99', planId: missing.id, resume: true});
    assert.equal(blocked.status, 409); assert.match((await blocked.json() as any).error, /manual recovery/);
    assert.deepEqual(await (await mf.dispatchFetch('https://test/calls')).json(), [], 'Missing files must not reach GitHub');
    const competing = await (await engine('/preview', {subject: '42', name: 'Missing'})).json() as any;
    const conflict = await engine('/create', {subject: '42', planId: competing.id});
    assert.equal(conflict.status, 409); assert.match((await conflict.json() as any).error, /repository lock/);
    const created = await engine('/create', {subject: '42', planId: healthy.id});
    assert.equal(created.status, 200); assert.equal((await created.json() as any).state, 'complete');
    let stub = await stateStub(mf); await call(stub, {}, '/expire');
    await call(stub, {action: 'put', subject: '42', remove: [damagedPreview.plan.id]});
    await mf.setOptions(convertV4MiniflareOptions({...options, script: script + '\n// restart'}));
    stub = await stateStub(mf);
    assert.deepEqual(await (await call(stub, {action: 'get', subject: '99', id: missing.id})).json(), {...damaged, recoveryError: 'missing_plan'});
    assert.deepEqual(await (await call(stub, {action: 'get', subject: '42', id: damagedPreview.plan.id})).json(), {...damagedPreview, recoveryError: 'missing_plan'});
  } finally {await mf.dispose();}
});

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
    const auth = await stateStub(mf, 'AUTH', 'auth-v1'), sid = 's'.repeat(43), key = `session:${await sha256(sid)}`;
    await call(auth, {action: 'put', key, value: await encrypt(crypt, {subject: '42', token: 'test', csrf: 'test'}, key), ttl: 60000});
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
    const headers = {Cookie: `__Host-pkgfactory-session=${await sessionCookieValue(crypt, sid)}`};
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
    const auth = await stateStub(mf, 'AUTH', 'auth-v1');
    const signIn = async (subject: string) => {
      const sid = subject.repeat(43).slice(0, 43), key = `session:${await sha256(sid)}`;
      await call(auth, {action: 'put', key, value: await encrypt(crypt, {subject, token: 'test', csrf: 'test'}, key), ttl: 60000});
      return {Cookie: `__Host-pkgfactory-session=${await sessionCookieValue(crypt, sid)}`, 'CF-Connecting-IP': '192.0.2.30'};
    };
    const first = await signIn('4'), second = await signIn('5');
    for (const expected of [200, 200, 200, 429]) assert.equal((await mf.dispatchFetch('https://pkgfactory.test/api/templates', {headers: first})).status, expected);
    assert.equal((await mf.dispatchFetch('https://pkgfactory.test/api/templates', {headers: second})).status, 200);
  } finally {await mf.dispose();}
});
