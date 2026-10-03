import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Factory } from '../packages/pkgfactory/src/application/engine.js';
import { MemoryStore } from '../packages/pkgfactory/src/application/state.js';
import { FakeGitHub } from './fake-github.js';
const credentials = {token: 'never-log-this', subject: '42'};
function fixture() {
  const remote = new FakeGitHub(); const store = new MemoryStore(); let now = Date.now();
  return {remote, store, factory: new Factory(store, {fetcher: remote.fetch, now: () => now}), advance: () => {now += 160000;}};
}
const input = (template = 'simple') => ({owner: 'tester', name: 'TestPackage', authors: ['Tester'], template});
for (const template of ['minimum', 'simple', 'all-in-one']) test(`create ${template}; repeated success performs no writes`, async () => {
  const {factory, remote} = fixture(); const plan = await factory.preview(input(template), '42');
  const result = await factory.execute(plan.id, credentials); assert.equal(result.state, 'complete');
  assert.equal(remote.files['Project.toml'], plan.files['Project.toml']);
  assert.deepEqual(remote.repository.topics, ['julia']);
  const initial = remote.calls.find(c => c.method === 'PUT' && c.path.endsWith('/contents/README.md'))!;
  assert.equal(initial.body.message, 'Using PkgFactory\n\nhttps://github.com/JuliaPackageFactory/PkgFactory.ts');
  const templateCommit = remote.calls.find(c => c.method === 'POST' && c.path.endsWith('/git/commits'))!;
  assert.match(templateCommit.body.message, /\[skip ci\]/);
  const complete = remote.calls.find(c => c.method === 'PUT' && c.path.endsWith('/contents/.pkgfactory.json'))!;
  assert.doesNotMatch(complete.body.message, /\[skip ci\]/);
  if (template !== 'minimum') assert(remote.calls.indexOf(complete) > remote.calls.findIndex(c => c.method === 'PUT' && c.path.endsWith('/DOCUMENTER_KEY')));
  const count = remote.calls.length; await factory.execute(plan.id, credentials); assert.equal(remote.calls.length, count);
});
for (const stage of ['repository', 'initialize', 'tree', 'commit', 'files', 'topics', 'deploy-key', 'documenter-secret', 'pages', 'complete']) test(`lost ${stage} response requires explicit reconciled resume`, async () => {
  const {factory, remote, store, advance} = fixture(); const plan = await factory.preview(input(), '42');
  const matches: Record<string, (method: string, path: string) => boolean> = {
    repository: (m, p) => m === 'POST' && p === '/user/repos', tree: (m, p) => m === 'POST' && p.endsWith('/trees'),
    initialize: (m, p) => m === 'PUT' && p.endsWith('/contents/README.md'),
    commit: (m, p) => m === 'POST' && p.endsWith('/commits'), files: (m, p) => m === 'PATCH' && p.endsWith('/heads/main'),
    topics: (m, p) => m === 'PUT' && p.endsWith('/topics'),
    'deploy-key': (m, p) => m === 'POST' && p.endsWith('/keys'), 'documenter-secret': (m, p) => m === 'PUT' && p.endsWith('/DOCUMENTER_KEY'),
    pages: (m, p) => m === 'POST' && p.endsWith('/pages'), complete: (m, p) => m === 'PUT' && p.endsWith('/contents/.pkgfactory.json'),
  };
  remote.after = (method, path) => {if (matches[stage](method, path)) {remote.after = undefined; throw new Error('Lost response');}};
  await assert.rejects(factory.execute(plan.id, credentials));
  assert.equal((await store.get(plan.id))?.pending?.stage, stage);
  await assert.rejects(factory.execute(plan.id, credentials, true), /deadline/);
  advance(); await assert.rejects(factory.execute(plan.id, credentials), /explicitly resume/);
  await factory.status(plan.id, credentials);
  await factory.execute(plan.id, credentials, true);
  assert.equal((await store.get(plan.id))?.state, 'complete');
  assert.ok((await store.get(plan.id))?.reconciliation);
  assert.equal(remote.keys.length, 1);
  assert.equal(remote.calls.filter(c => c.method === 'PUT' && c.path.endsWith('/contents/README.md')).length, 1);
  assert.deepEqual(remote.repository.topics, ['julia']);
  assert.equal(remote.calls.filter(c => c.method === 'PUT' && c.path.endsWith('/topics')).length, 1);
  assert.ok(!JSON.stringify(await store.get(plan.id)).includes(credentials.token));
});
for (const topics of [['scientific-computing'], ['scientific-computing', 'julia']]) test(`resume preserves existing topics: ${topics.join(', ')}`, async () => {
  const {factory, remote, store, advance} = fixture(); const plan = await factory.preview(input('minimum'), '42');
  remote.before = (method, path) => {if (method === 'PUT' && path.endsWith('/topics')) throw new Error('Topic update failed');};
  await assert.rejects(factory.execute(plan.id, credentials), /GitHub request failed/);
  assert.equal((await store.get(plan.id))?.pending?.stage, 'topics');
  remote.before = undefined;
  remote.repository.topics = [...topics];
  advance();
  const result = await factory.execute(plan.id, credentials, true);
  assert.equal(result.state, 'complete');
  assert.deepEqual(remote.repository.topics, ['scientific-computing', 'julia']);
  assert.equal(remote.calls.filter(c => c.method === 'PUT' && c.path.endsWith('/topics')).length, topics.includes('julia') ? 0 : 1);
});
test('disconnect stops all subsequent GitHub requests and retains lock', async () => {
  const {factory, remote, store} = fixture(); const plan = await factory.preview(input(), '42'); const abort = new AbortController();
  remote.after = (method, path) => {if (method === 'POST' && path.endsWith('/trees')) abort.abort();};
  await assert.rejects(factory.execute(plan.id, credentials, false, abort.signal));
  assert.equal(remote.calls.at(-1)?.path, '/repos/tester/TestPackage.jl/git/trees');
  assert.equal((await store.get(plan.id))?.state, 'paused');
});
test('other subjects cannot execute or inspect a plan', async () => {
  const {factory} = fixture(); const plan = await factory.preview(input(), '42');
  await assert.rejects(factory.execute(plan.id, {...credentials, subject: '99'}), /not found/);
  await assert.rejects(factory.status(plan.id, {...credentials, subject: '99'}), /not found/);
});
test('competing plans and changed Project.toml are refused', async () => {
  const {factory, remote, advance} = fixture(); const plan = await factory.preview(input(), '42');
  remote.after = (method, path) => {if (method === 'POST' && path.endsWith('/keys')) throw new Error('stop');};
  await assert.rejects(factory.execute(plan.id, credentials)); remote.after = undefined; advance();
  const other = await factory.preview(input(), '42'); await assert.rejects(factory.execute(other.id, credentials), /holds this repository lock/);
  remote.files['Project.toml'] += '\n# user change'; await assert.rejects(factory.execute(plan.id, credentials, true), /Project.toml changed/);
});
test('replaced or missing repository cannot inherit a saved operation', async () => {
  const {factory, remote, advance} = fixture(); const plan = await factory.preview(input(), '42');
  remote.after = (method, path) => {if (method === 'POST' && path.endsWith('/keys')) throw new Error('stop');};
  await assert.rejects(factory.execute(plan.id, credentials)); remote.after = undefined; advance();
  remote.repository.id = 99;
  await assert.rejects(factory.execute(plan.id, credentials, true), /Repository was replaced/);
  advance(); remote.repository = null;
  const count = remote.calls.filter(c => c.method !== 'GET').length;
  await assert.rejects(factory.execute(plan.id, credentials, true), /no longer visible/);
  assert.equal(remote.calls.filter(c => c.method !== 'GET').length, count);
});
