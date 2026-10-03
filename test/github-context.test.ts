import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Factory } from '../packages/pkgfactory/src/application/engine.js';
import { MemoryStore } from '../packages/pkgfactory/src/application/state.js';
import { api } from '../packages/pkgfactory/src/web/routes.js';
import { page } from '../packages/pkgfactory/src/web/page.js';
import { packageNameError } from '../packages/pkgfactory/src/core/package-name.js';

const credentials = {subject: '42', token: 'private-token'};
const membership = (login: string, role = 'admin', state = 'active') => ({role, state, organization: {login}});

test('app status checks the selected organization and paginates installation results', async () => {
  const calls: string[] = [];
  const factory = new Factory(new MemoryStore(), {fetcher: async (input, init) => {
    assert.equal(init?.method, 'GET');
    const url = new URL(String(input)); calls.push(url.pathname);
    if (url.pathname === '/user') return Response.json({id: 42, login: 'tester'});
    if (url.pathname === '/user/memberships/orgs/Owned') return Response.json(membership('Owned'));
    assert.equal(url.pathname, '/orgs/Owned/installations');
    return Response.json({installations: url.searchParams.get('page') === '1'
      ? Array.from({length: 100}, () => ({app_slug: 'unrelated'}))
      : [{app_slug: 'codecov', repository_selection: 'selected', suspended_at: null}, {app_slug: 'juliaregistrator', repository_selection: 'all', suspended_at: '2026-09-01'}]});
  }});
  assert.deepEqual(await factory.githubApps({owner: 'Owned'}, credentials), {
    codecov: {state: 'installed', selection: 'selected'}, juliaregistrator: {state: 'suspended', selection: 'all'},
  });
  assert.equal(calls.filter(path => path === '/orgs/Owned/installations').length, 2);
  calls.length = 0;
  assert.deepEqual(await factory.githubApps({owner: 'TESTER'}, credentials), {codecov: {state: 'unknown'}, juliaregistrator: {state: 'unknown'}});
  assert.deepEqual(calls, ['/user']);
});

test('missing app-read permissions or a failed lookup are unknown, never not-installed', async () => {
  for (const status of [200, 403, 404, 429, 500]) {
    const factory = new Factory(new MemoryStore(), {fetcher: async input => {
      const path = new URL(String(input)).pathname;
      if (path === '/user') return Response.json({id: 42, login: 'tester'});
      if (path === '/user/memberships/orgs/Owned') return Response.json(membership('Owned'));
      return Response.json({installations: []}, {status});
    }});
    const result = await factory.githubApps({owner: 'Owned'}, credentials);
    assert.equal(result.codecov.state, status === 200 ? 'not-installed' : 'unknown');
    assert.equal(result.juliaregistrator.state, status === 200 ? 'not-installed' : 'unknown');
  }
});

test('app reads reject another identity or an unauthorized owner and stop on cancellation', async () => {
  const calls: string[] = [];
  const factory = new Factory(new MemoryStore(), {fetcher: async input => {
    const path = new URL(String(input)).pathname; calls.push(path);
    return Response.json(path === '/user' ? {id: 42, login: 'tester'} : membership('Member', 'member'));
  }});
  await assert.rejects(factory.githubApps({owner: 'Member'}, credentials), {code: 'owner'});
  await assert.rejects(factory.githubApps({owner: 'tester'}, {...credentials, subject: '99'}), {code: 'identity'});
  assert(!calls.some(path => path.endsWith('/installations')));
  const controller = new AbortController(); controller.abort();
  const count = calls.length;
  await assert.rejects(factory.githubApps({owner: 'Owned'}, credentials, controller.signal));
  assert.equal(calls.length, count);
});

test('profile paginates memberships, includes only active owners, and never exposes credentials', async () => {
  let pages = 0;
  const factory = new Factory(new MemoryStore(), {fetcher: async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/user') return Response.json({id: 42, login: 'tester', name: 'Test Author', email: 'private@example.test'});
    assert.equal(url.pathname, '/user/memberships/orgs'); assert.equal(url.searchParams.get('state'), 'active');
    pages++;
    return Response.json(pages === 1 ? Array.from({length: 100}, (_, i) => membership(`Member${i}`, 'member')) : [membership('Owned'), membership('Invited', 'admin', 'pending')]);
  }});
  const result = await factory.githubProfile(credentials);
  assert.equal(pages, 2); assert.equal(result.user.name, 'Test Author');
  assert.deepEqual(result.owners.map(o => o.login), ['tester', 'Owned']);
  assert.doesNotMatch(JSON.stringify(result), /private-token|private@example/);
  const noName = new Factory(new MemoryStore(), {fetcher: async input => Response.json(String(input).endsWith('/user') ? {id: 42, login: 'tester', name: null} : [])});
  assert.equal((await noName.githubProfile(credentials)).user.name, 'tester');
});

test('availability validates names and owner role before looking up private or public repositories', async () => {
  const calls: string[] = [];
  const factory = new Factory(new MemoryStore(), {fetcher: async (input, init) => {
    assert.equal(init?.method, 'GET'); const path = new URL(String(input)).pathname; calls.push(path);
    if (path === '/user') return Response.json({id: 42, login: 'tester'});
    if (path.startsWith('/user/memberships/')) return Response.json(membership(path.split('/').pop()!, path.endsWith('/Owned') ? 'admin' : 'member'));
    if (path.endsWith('/Existing.jl')) return Response.json({private: true});
    return new Response(null, {status: 404});
  }});
  assert.deepEqual(await factory.repositoryAvailability({owner: 'Owned', name: 'NewPackage.jl'}, credentials), {repository: 'Owned/NewPackage.jl', available: true});
  assert.equal((await factory.repositoryAvailability({owner: 'tester', name: 'Existing'}, credentials)).available, false);
  await assert.rejects(factory.repositoryAvailability({owner: 'Member', name: 'NewPackage'}, credentials), {code: 'owner'});
  assert(!calls.includes('/repos/Member/NewPackage.jl'));
  const count = calls.length;
  await assert.rejects(factory.repositoryAvailability({owner: 'tester', name: '../Bad'}, credentials), {code: 'name'});
  for (const name of ['JuliaPkg', 'JustInTime', 'UPPER123', 'Cake', 'VMCjl']) {
    await assert.rejects(factory.repositoryAvailability({owner: 'tester', name}, credentials), {code: 'name', message: packageNameError(name)});
  }
  assert.equal(calls.length, count);
  await assert.rejects(factory.repositoryAvailability({owner: 'tester', name: 'Valid'}, {...credentials, subject: '99'}), {code: 'identity'});
});

test('failed account reads never become availability success and cancellation stops further GitHub reads', async () => {
  for (const status of [401, 403, 429, 500]) {
    const factory = new Factory(new MemoryStore(), {fetcher: async () => new Response('{}', {status})});
    await assert.rejects(factory.repositoryAvailability({owner: 'tester', name: 'Valid'}, credentials));
    await assert.rejects(factory.githubProfile(credentials));
  }
  const controller = new AbortController(); let calls = 0;
  const factory = new Factory(new MemoryStore(), {fetcher: async () => {calls++; controller.abort(); return Response.json({id: 42, login: 'tester'});}});
  await assert.rejects(factory.repositoryAvailability({owner: 'tester', name: 'Valid'}, credentials, controller.signal));
  assert.equal(calls, 1);
});

test('Web preview repeats the availability check and new creation rechecks organization ownership', async () => {
  let role = 'admin', exists = true; const writes: string[] = [];
  const factory = new Factory(new MemoryStore(), {fetcher: async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (init?.method !== 'GET') writes.push(path);
    if (path === '/user') return Response.json({id: 42, login: 'tester'});
    if (path.startsWith('/user/memberships/')) return Response.json(membership('Owned', role));
    return exists ? Response.json({id: 10}) : new Response(null, {status: 404});
  }});
  const spec = {owner: 'Owned', name: 'Valid', authors: ['Test'], template: 'minimum'};
  const request = () => new Request('http://localhost/api/preview', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(spec)});
  await assert.rejects(api(request(), factory, '42', () => credentials), {code: 'exists'});
  exists = false;
  const preview = await (await api(request(), factory, '42', () => credentials)).json() as any;
  role = 'member';
  await assert.rejects(factory.execute(preview.id, credentials), {code: 'owner'});
  assert.deepEqual(writes, []);
  assert.match(page('', true, false, 'https://pkgfactory.test'), /id="package-form"[^>]*hidden/);
  assert.match(page('', true, false, 'https://pkgfactory.test'), /href="\/auth\/login"/);
});
