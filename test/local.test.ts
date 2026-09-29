import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Factory } from '../packages/pkgfactory/src/application/engine.js';
import { MemoryStore } from '../packages/pkgfactory/src/application/state.js';
import { FileStore } from '../packages/pkgfactory/src/node/store.js';
import { localWeb } from '../packages/pkgfactory/src/node/web.js';
import { FakeGitHub } from './fake-github.js';
test('local Web previews, creates, and refuses invalid Origin, CSRF, and Host', async () => {
  const remote = new FakeGitHub();
  const {server, origin} = await localWeb(new Factory(new MemoryStore(), {local: true, fetcher: remote.fetch}), 'token', 0);
  try {
    const html = await (await fetch(origin)).text(); const csrf = html.match(/name="csrf-token" content="([^"]+)"/)![1];
    const headers = {'Content-Type': 'application/json', Origin: origin, 'X-PkgFactory-CSRF': csrf};
    const profile = await (await fetch(origin + '/api/github/profile')).json() as any;
    assert.equal(profile.user.name, 'Test Author');
    const apps = await fetch(origin + '/api/github/apps', {method: 'POST', headers, body: JSON.stringify({owner: 'tester'})});
    assert.deepEqual(await apps.json(), {codecov: {state: 'unknown'}, juliaregistrator: {state: 'unknown'}});
    const availability = await fetch(origin + '/api/github/availability', {method: 'POST', headers, body: JSON.stringify({owner: 'tester', name: 'Local'})});
    assert.equal((await availability.json() as any).available, true);
    const body = JSON.stringify({owner: 'tester', name: 'Local', authors: ['Tester'], template: 'minimum'});
    const preview = await fetch(origin + '/api/preview', {method: 'POST', headers, body}); assert.equal(preview.status, 200);
    const original = await preview.json() as any;
    const replacement = await fetch(origin + '/api/preview', {method: 'POST', headers, body: JSON.stringify({...JSON.parse(body), description: 'Updated', replacePlanId: original.id})});
    assert.equal(replacement.status, 200);
    const plan = await replacement.json() as any;
    assert.notEqual(plan.id, original.id); assert.equal(plan.spec.description, 'Updated');
    assert.equal((await fetch(origin + '/api/preview', {method: 'POST', headers, body: JSON.stringify({...JSON.parse(body), replacePlanId: 'invalid'})})).status, 400);
    const result = await fetch(origin + '/api/create', {method: 'POST', headers, body: JSON.stringify({planId: plan.id, confirm: true})}); assert.equal(result.status, 200);
    assert.equal((await fetch(origin + '/api/preview', {method: 'POST', headers: {...headers, Origin: 'https://attacker.example'}, body})).status, 403);
    assert.equal((await fetch(origin + '/api/preview', {method: 'POST', headers: {...headers, 'X-PkgFactory-CSRF': 'wrong'}, body})).status, 403);
    const badHost = await new Promise<number>(resolve => {httpRequest(origin, {headers: {Host: 'attacker.example'}}, response => {response.resume(); resolve(response.statusCode!);}).end();});
    assert.equal(badHost, 403);
  } finally {server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));}
});
test('automatic previews replace only their own unused plan and preserve started operations', async () => {
  const store = new MemoryStore(); const factory = new Factory(store);
  const spec = {owner: 'tester', name: 'Automatic', authors: ['Tester'], template: 'minimum'};
  let plan = await factory.preview(spec, 'viewer');
  for (let i = 0; i < 20; i++) {
    const oldId = plan.id;
    plan = await factory.preview({...spec, description: String(i)}, 'viewer', oldId);
    assert.equal(await store.get(oldId), undefined);
    assert.equal(await store.transaction(items => items.size), 1);
  }
  const foreign = await factory.preview(spec, 'another-viewer');
  await assert.rejects(factory.preview(spec, 'viewer', foreign.id), /ownership mismatch/);
  assert.ok(await store.get(foreign.id));
  for (const state of ['running', 'paused', 'complete'] as const) {
    const operation = (await store.get(plan.id))!; operation.state = state; await store.put(operation);
    await factory.preview(spec, 'viewer', plan.id);
    assert.deepEqual(await store.get(plan.id), operation);
  }
});
test('local journal survives restart and serializes independent instances', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pkgfactory-journal-'));
  try {
    const a = new Factory(new FileStore(dir)); const b = new Factory(new FileStore(dir));
    const plans = await Promise.all([a.preview({owner: 'tester', name: 'FirstPackage', authors: ['T']}, 'local'), b.preview({owner: 'tester', name: 'SecondPackage', authors: ['T']}, 'local')]);
    for (const plan of plans) assert.equal((await new FileStore(dir).get(plan.id))?.plan.digest, plan.digest);
  } finally {await rm(dir, {recursive: true, force: true});}
});
test('stdio MCP initializes, lists tools, and previews offline without polluting stdout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pkgfactory-mcp-'));
  const transport = new StdioClientTransport({command: process.execPath, args: ['--import', 'tsx', resolve('packages/pkgfactory/src/node/cli.ts'), 'mcp', '--stdio', '--read-only', '--state-dir', dir], env: {PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', GITHUB_TOKEN: '', GH_TOKEN: ''}, stderr: 'pipe'});
  const client = new Client({name: 'acceptance', version: '1'});
  try {
    await client.connect(transport);
    const {tools} = await client.listTools(); assert.deepEqual(tools.map(t => t.name).sort(), ['list_templates', 'preview_package', 'repository_status']);
    const result = await client.callTool({name: 'preview_package', arguments: {owner: 'tester', name: 'McpTest', authors: ['T']}});
    assert.ok(!result.isError); assert.match(JSON.stringify(result), /src\/McpTest.jl/);
  } finally {await client.close(); await rm(dir, {recursive: true, force: true});}
});
