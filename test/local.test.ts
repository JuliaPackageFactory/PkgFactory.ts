import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Factory } from '../packages/pkgfactory/src/application/engine.js';
import { localWeb } from '../packages/pkgfactory/src/node/web.js';
import { FakeGitHub } from './fake-github.js';
test('local Web serves the bundled hero image before connecting GitHub', async () => {
  const {server, origin} = await localWeb(new Factory({local: true}), undefined, 0);
  try {
    const hero = await fetch(origin + '/assets/hero.png');
    assert.equal(hero.status, 200);
    assert.equal(hero.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await hero.arrayBuffer()), await readFile(new URL('../packages/pkgfactory/src/web/hero.png', import.meta.url)));
  } finally {server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));}
});

test('local Web previews, creates from the previewed plan, and refuses invalid Origin, CSRF, and Host', async () => {
  const remote = new FakeGitHub();
  const {server, origin} = await localWeb(new Factory({local: true, fetcher: remote.fetch}), 'token', 0);
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
    const plan = await preview.json() as any;
    const reference = {id: plan.id, uuid: plan.uuid, createdAt: plan.createdAt};
    assert.equal((await fetch(origin + '/api/create', {method: 'POST', headers, body: JSON.stringify({...plan.spec, plan: reference})})).status, 400, 'Confirmation is required');
    assert.equal((await fetch(origin + '/api/create', {method: 'POST', headers, body: JSON.stringify({...plan.spec, plan: {id: 'invalid'}, confirm: true})})).status, 400, 'A malformed reference is rejected');
    assert.deepEqual(remote.calls.filter(c => c.method !== 'GET'), []);
    const result = await fetch(origin + '/api/create', {method: 'POST', headers, body: JSON.stringify({...plan.spec, plan: reference, confirm: true})}); assert.equal(result.status, 200);
    assert.equal((await result.json() as any).state, 'complete');
    assert.equal(remote.files['Project.toml'], plan.files['Project.toml'], 'The created files are the previewed files');
    assert.equal((await fetch(origin + '/api/preview', {method: 'POST', headers: {...headers, Origin: 'https://attacker.example'}, body})).status, 403);
    assert.equal((await fetch(origin + '/api/preview', {method: 'POST', headers: {...headers, 'X-PkgFactory-CSRF': 'wrong'}, body})).status, 403);
    const badHost = await new Promise<number>(resolve => {httpRequest(origin, {headers: {Host: 'attacker.example'}}, response => {response.resume(); resolve(response.statusCode!);}).end();});
    assert.equal(badHost, 403);
  } finally {server.closeAllConnections(); await new Promise<void>(r => server.close(() => r()));}
});
test('stdio MCP initializes, lists tools, and previews offline without polluting stdout', async () => {
  const transport = new StdioClientTransport({command: process.execPath, args: ['--import', 'tsx', resolve('packages/pkgfactory/src/node/cli.ts'), 'mcp', '--stdio', '--read-only'], env: {PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', GITHUB_TOKEN: '', GH_TOKEN: ''}, stderr: 'pipe'});
  const client = new Client({name: 'acceptance', version: '1'});
  try {
    await client.connect(transport);
    const {tools} = await client.listTools(); assert.deepEqual(tools.map(t => t.name).sort(), ['list_templates', 'preview_package']);
    const result = await client.callTool({name: 'preview_package', arguments: {owner: 'tester', name: 'McpTest', authors: ['T']}});
    assert.ok(!result.isError); assert.match(JSON.stringify(result), /src\/McpTest.jl/);
  } finally {await client.close();}
});
