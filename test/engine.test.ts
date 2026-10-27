import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Factory } from '../packages/pkgfactory/src/application/engine.js';
import { restorePlan, planReference } from '../packages/pkgfactory/src/core/plan.js';
import { FakeGitHub } from './fake-github.js';
const credentials = {token: 'never-log-this', subject: '42'};
function fixture() {
  const remote = new FakeGitHub();
  return {remote, factory: new Factory({fetcher: remote.fetch})};
}
const input = (template = 'simple') => ({owner: 'tester', name: 'TestPackage', authors: ['Tester'], template});
const writes = (remote: FakeGitHub) => remote.calls.filter(c => c.method !== 'GET');
for (const template of ['minimum', 'simple', 'all-in-one']) test(`create ${template} from a regenerated preview; an existing repository refuses every write`, async () => {
  const {factory, remote} = fixture(); const previewed = await factory.preview(input(template));
  // Clients keep only the spec and the fixed values; the server regenerates the identical files.
  const plan = await restorePlan(previewed.spec, planReference(previewed));
  assert.deepEqual(plan, previewed);
  const result = await factory.execute(plan, credentials); assert.equal(result.state, 'complete');
  assert.equal(result.pagesUrl, template === 'minimum' ? undefined : 'https://tester.github.io/Test.jl/');
  assert.equal(remote.files['Project.toml'], plan.files['Project.toml']);
  assert.deepEqual(JSON.parse(remote.files['.pkgfactory.json']).state, 'complete');
  assert.deepEqual(remote.repository.topics, ['julia', 'juliapackagefactory']);
  assert.equal(remote.repository.description, '');
  const initial = remote.calls.find(c => c.method === 'PUT' && c.path.endsWith('/contents/README.md'))!;
  assert.equal(initial.body.message, 'Using PkgFactory\n\nhttps://github.com/JuliaPackageFactory/PkgFactory.ts');
  const templateCommit = remote.calls.find(c => c.method === 'POST' && c.path.endsWith('/git/commits'))!;
  assert.match(templateCommit.body.message, /\[skip ci\]/);
  const complete = remote.calls.find(c => c.method === 'PUT' && c.path.endsWith('/contents/.pkgfactory.json'))!;
  assert.doesNotMatch(complete.body.message, /\[skip ci\]/);
  if (template !== 'minimum') {
    assert(remote.calls.indexOf(complete) > remote.calls.findIndex(c => c.method === 'PUT' && c.path.endsWith('/DOCUMENTER_KEY')));
    assert.equal(remote.keys.length, 1); assert.equal(remote.keys[0].title, `PkgFactory:${plan.id}`);
  }
  const count = remote.calls.length;
  await assert.rejects(factory.execute(plan, credentials), /already exists/);

  assert.equal(remote.calls.length, count + 2, 'Only /user and the repository read are sent for a personal owner');
  assert.ok(!JSON.stringify(remote.calls).includes(credentials.token));
});
for (const stage of ['repository', 'initialize', 'tree', 'commit', 'files', 'topics', 'gh-pages', 'deploy-key', 'documenter-secret', 'pages', 'complete']) test(`a lost ${stage} response stops setup, names the step and sends nothing further`, async () => {
  const {factory, remote} = fixture(); const plan = await factory.preview(input());
  const matches: Record<string, (method: string, path: string) => boolean> = {
    repository: (m, p) => m === 'POST' && p === '/user/repos', tree: (m, p) => m === 'POST' && p.endsWith('/trees'),
    initialize: (m, p) => m === 'PUT' && p.endsWith('/contents/README.md'),
    commit: (m, p) => m === 'POST' && p.endsWith('/commits'), files: (m, p) => m === 'PATCH' && p.endsWith('/heads/main'),
    topics: (m, p) => m === 'PUT' && p.endsWith('/topics'), 'gh-pages': (m, p) => m === 'POST' && p.endsWith('/git/refs'),
    'deploy-key': (m, p) => m === 'POST' && p.endsWith('/keys'), 'documenter-secret': (m, p) => m === 'PUT' && p.endsWith('/DOCUMENTER_KEY'),
    pages: (m, p) => m === 'POST' && p.endsWith('/pages'), complete: (m, p) => m === 'PUT' && p.endsWith('/contents/.pkgfactory.json'),
  };
  remote.after = (method, path) => {if (matches[stage](method, path)) {remote.after = undefined; throw new Error('Lost response');}};
  const count = () => remote.calls.length;
  let calls = 0;
  await assert.rejects(factory.execute(plan, credentials), (error: any) => {
    calls = count();
    assert.equal(error.code, 'incomplete');
    assert.match(error.message, new RegExp(`stopped at the "${stage}" step`));
    assert.match(error.message, /outcome of that request is unknown/);
    assert.match(error.message, /delete it before creating the package again/);
    return true;
  });
  assert.equal(count(), calls, 'No request follows the lost response');
  assert.ok(matches[stage](remote.calls.at(-1)!.method, remote.calls.at(-1)!.path), 'The lost request is the last one sent');
  assert.ok(!JSON.stringify(remote.calls).includes(credentials.token));
});
test('a GitHub error names the failing step and status without retrying', async () => {
  const {factory, remote} = fixture(); const plan = await factory.preview(input('minimum'));
  remote.before = (method, path) => {if (method === 'PUT' && path.endsWith('/topics')) throw new Error('Topic update failed');};
  await assert.rejects(factory.execute(plan, credentials), /stopped at the "topics" step. GitHub request failed \(network\)/);
  assert.equal(remote.calls.filter(c => c.method === 'PUT' && c.path.endsWith('/topics')).length, 0, 'before() rejects without recording the call');
  assert.equal(remote.calls.at(-1)!.path, '/repos/tester/TestPackage.jl/git/refs/heads/main');
});
test('disconnect stops all subsequent GitHub requests', async () => {
  const {factory, remote} = fixture(); const plan = await factory.preview(input()); const abort = new AbortController();
  remote.after = (method, path) => {if (method === 'POST' && path.endsWith('/trees')) abort.abort();};
  await assert.rejects(factory.execute(plan, credentials, abort.signal), /stopped at the "commit" step. The connection closed/);
  assert.equal(remote.calls.at(-1)?.path, '/repos/tester/TestPackage.jl/git/trees');
});
test('another identity, an unavailable owner, or a cancelled signal refuse before any write', async () => {
  const {factory, remote} = fixture(); const plan = await factory.preview(input());
  await assert.rejects(factory.execute(plan, {...credentials, subject: '99'}), /identity changed/);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(factory.execute(plan, credentials, cancelled.signal));
  assert.equal(writes(remote).length, 0);
  remote.repository = {id: 10, default_branch: 'main', description: '', topics: []};
  await assert.rejects(factory.previewForAccount(input(), credentials), /already exists/);
  await assert.rejects(factory.execute(plan, credentials), /already exists/);
  assert.equal(writes(remote).length, 0);
});
test('a regenerated plan rejects edited settings and a malformed reference', async () => {
  const {factory} = fixture(); const plan = await factory.preview(input());
  const edited = await restorePlan({...plan.spec, description: 'Edited'}, planReference(plan));
  assert.notEqual(edited.digest, plan.digest); assert.equal(edited.id, plan.id);
  await assert.rejects(restorePlan(plan.spec, {id: plan.id, uuid: plan.uuid}));
  await assert.rejects(restorePlan(plan.spec, {...planReference(plan), createdAt: 'yesterday'}));
  await assert.rejects(restorePlan(plan.spec, {...planReference(plan), extra: true}));
});
