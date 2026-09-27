import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mcpHttp } from '../packages/pkgfactory/src/mcp/server.js';
import { Factory } from '../packages/pkgfactory/src/application/engine.js';
import { MemoryStore } from '../packages/pkgfactory/src/application/state.js';
import { FakeGitHub } from './fake-github.js';
test('Streamable HTTP negotiates, lists tools, previews and creates with request cancellation', async () => {
  const remote = new FakeGitHub(); const store = new MemoryStore(); const factory = new Factory(store, {fetcher: remote.fetch});
  const credentials = {subject: '42', token: 'secret'};
  const call = async (method: string, params: unknown, signal?: AbortSignal) => {
    const response = await mcpHttp(new Request('https://pkgfactory.test/mcp', {method: 'POST', signal, headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25'}, body: JSON.stringify({jsonrpc: '2.0', id: crypto.randomUUID(), method, params})}), factory, credentials);
    assert.equal(response.status, 200); return await response.json() as any;
  };
  const initialized = await call('initialize', {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'test', version: '1'}});
  assert.equal(initialized.result.serverInfo.name, 'PkgFactory');
  assert.equal((await call('tools/list', {})).result.tools.length, 5);
  const preview = await call('tools/call', {name: 'preview_package', arguments: {owner: 'tester', name: 'Remote', authors: ['Tester'], template: 'minimum'}});
  const plan = JSON.parse(preview.result.content[0].text);
  const result = await call('tools/call', {name: 'create_package', arguments: {planId: plan.id, confirm: true}});
  assert.equal(JSON.parse(result.result.content[0].text).state, 'complete');
  const plan2 = await factory.preview({owner: 'tester', name: 'Cancelled', authors: ['Tester']}, '42');
  const abort = new AbortController(); abort.abort();
  const before = remote.calls.length;
  await assert.rejects(factory.execute(plan2.id, credentials, false, abort.signal)); assert.equal(remote.calls.length, before);
});
