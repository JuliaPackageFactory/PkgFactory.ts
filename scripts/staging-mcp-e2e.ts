// Interactive staging acceptance. OAuth credentials stay in memory and are never logged.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { escapeHtml } from '../packages/pkgfactory/src/web/http.js';

const origin = 'https://pkgfactory-staging.ohnolab.workers.dev';
const serverUrl = new URL('/mcp', origin);
const live = process.argv.includes('--confirm-create-test-repositories');
const disconnect = process.argv.includes('--confirm-disconnect-and-resume');
const resumeId = process.argv.find(v => v.startsWith('--resume-plan='))?.split('=')[1];
if ((resumeId || disconnect) && !live) throw new Error('Resuming requires --confirm-create-test-repositories');
if (resumeId && disconnect) throw new Error('Choose either a saved resume plan or the disconnect acceptance case');
const state = randomUUID();
let information: OAuthClientInformationMixed | undefined;
let tokens: OAuthTokens | undefined;
let verifier = '';
let authorizationUrl: URL | undefined;
let used = false;
let authorize!: () => void;
let rejectAuthorization!: (error: Error) => void;
const authorization = new Promise<void>((resolve, reject) => {authorize = resolve; rejectAuthorization = reject;});
const listener = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  if (request.headers.host !== new URL(localOrigin).host || request.method !== 'GET') {response.writeHead(403).end(); return;}
  const url = new URL(request.url!, localOrigin);
  if (url.pathname === '/' && authorizationUrl) {
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<h1>PkgFactory staging acceptance</h1><p>Credentials remain in this process only.</p><a href="${escapeHtml(authorizationUrl.href)}">Authorize staging MCP test</a>`);
    return;
  }
  if (url.pathname !== '/callback') {response.writeHead(404).end(); return;}
  if (used || url.searchParams.get('state') !== state || (url.searchParams.has('iss') && url.searchParams.get('iss') !== origin)) {response.writeHead(400).end('Invalid OAuth callback'); return;}
  used = true;
  try {
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.has('error')) throw new Error('Authorization was not granted');
    assert.equal(await auth(provider, {serverUrl, authorizationCode: code}), 'AUTHORIZED');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    response.end('MCP authorization complete. Acceptance tests are running. You may close this tab.');
    authorize();
  } catch {
    response.writeHead(400).end('Authorization failed. Restart the test to try again.');
    rejectAuthorization(new Error('OAuth callback or token exchange failed'));
  }
});
await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
const address = listener.address(); assert(address && typeof address !== 'string');
const localOrigin = `http://127.0.0.1:${address.port}`;
const provider: OAuthClientProvider = {
  redirectUrl: `${localOrigin}/callback`,
  clientMetadata: {client_name: 'PkgFactory staging acceptance', redirect_uris: [`${localOrigin}/callback`], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'pkgfactory'},
  state: () => state,
  clientInformation: () => information,
  saveClientInformation: value => {information = value;},
  tokens: () => tokens,
  saveTokens: value => {tokens = value;},
  redirectToAuthorization: url => {authorizationUrl = url;},
  saveCodeVerifier: value => {verifier = value;},
  codeVerifier: () => verifier,
};
const report: any = {origin, startedAt: new Date().toISOString(), live, disconnect, results: []};
const reportPath = disconnect ? 'artifacts/staging-disconnect-e2e.json' : resumeId ? 'artifacts/staging-resume-e2e.json' : 'artifacts/staging-mcp-e2e.json';
const save = async () => {await mkdir('artifacts', {recursive: true}); await writeFile(reportPath, JSON.stringify(report, null, 2));};
const client = new Client({name: 'PkgFactory staging acceptance', version: '0.1.0'});
const transport = new StreamableHTTPClientTransport(serverUrl, {authProvider: provider, reconnectionOptions: {maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1}});
const tool = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({name, arguments: args}, undefined, {timeout: 130000});
  const content = result.content as {type: string; text?: string}[];
  const data = JSON.parse(content.find(c => c.type === 'text')?.text ?? '{}');
  if (result.isError) throw new Error(`${name}: ${data.error ?? 'failed'}`);
  return data;
};
const record = async (item: unknown) => {report.results.push(item); await save(); console.log(JSON.stringify(item));};
let expiry: ReturnType<typeof setTimeout> | undefined;
try {
  assert.equal(await auth(provider, {serverUrl, scope: 'pkgfactory'}), 'REDIRECT');
  console.log(`Open ${localOrigin}/ to authorize this test. Live writes: ${live}.`);
  expiry = setTimeout(() => rejectAuthorization(new Error('Authorization timed out after 30 minutes')), 30 * 60000);
  await authorization; clearTimeout(expiry);
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map(t => t.name);
  assert.equal(tools.length, 5); await record({check: 'oauth-and-tools', tools});
  const templates = await tool('list_templates', {}); assert.equal(templates.length, 3);
  const run = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  if (resumeId) {
    const status = await tool('repository_status', {planId: resumeId});
    assert.match(status.repository, /^JuliaPackageFactory\/PkgFactory(?:Edge|Web)\d+\.jl$/);
    await record({check: 'before-explicit-resume', status});
    assert(!status.leaseUntil || status.leaseUntil <= Date.now(), 'Lease remains active. Wait, inspect again, and explicitly restart with --resume-plan.');
    await record({check: 'explicit-resume', planId: resumeId, result: await tool('resume_package', {planId: resumeId, confirm: true})});
  } else if (disconnect) {
    const plan = await tool('preview_package', {owner: 'JuliaPackageFactory', name: `PkgFactoryEdge${run}9`, template: 'all-in-one', authors: ['PkgFactory staging acceptance'], description: 'PkgFactory.ts disconnect and explicit resume acceptance'});
    await record({check: 'disconnect-plan', planId: plan.id, repository: plan.repository});
    const controller = new AbortController();
    let finished = false;
    // Use one raw HTTP call so an actual closed connection is exercised. No retry.
    const request = fetch(serverUrl, {method: 'POST', signal: controller.signal, redirect: 'manual', headers: {Authorization: `Bearer ${tokens!.access_token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': transport.protocolVersion!}, body: JSON.stringify({jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: {name: 'create_package', arguments: {planId: plan.id, confirm: true}}})})
      .then(async response => {await response.text(); return {completed: true};}, () => ({completed: false}))
      .catch(() => ({completed: false})).finally(() => {finished = true;});
    try {
      let observed: any;
      const deadline = Date.now() + 25000;
      while (!finished && Date.now() < deadline) {
        observed = await tool('repository_status', {planId: plan.id});
        if (observed.exists) break;
        await delay(200);
      }
      assert(observed?.exists && observed.state !== 'complete' && !finished, 'Creation finished or failed before a mid-operation disconnect could be observed');
      controller.abort();
      assert.equal((await request).completed, false);
      await record({check: 'http-disconnected', planId: plan.id, at: new Date().toISOString(), observed});
      await delay(2000);
      const first = await tool('repository_status', {planId: plan.id});
      await delay(3000);
      const stopped = await tool('repository_status', {planId: plan.id});
      const remoteState = (s: any) => ({exists: s.exists, head: s.head, markerMatches: s.markerMatches, remoteState: s.remoteState, deployKeys: s.deployKeys, documenterSecret: s.documenterSecret, pagesUrl: s.pagesUrl});
      assert.notEqual(stopped.state, 'complete');
      assert.deepEqual(remoteState(stopped), remoteState(first), 'GitHub writes continued after the disconnect settled');
      await record({check: 'writes-stopped', first, stopped});
      if (stopped.leaseUntil > Date.now()) {
        await record({check: 'waiting-for-recorded-lease', until: new Date(stopped.leaseUntil).toISOString()});
        await delay(stopped.leaseUntil - Date.now() + 500);
      }
      const beforeResume = await tool('repository_status', {planId: plan.id});
      assert.notEqual(beforeResume.state, 'complete');
      assert.deepEqual(remoteState(beforeResume), remoteState(stopped));
      await record({check: 'review-before-explicit-resume', status: beforeResume});
      // The operator explicitly opts into this one resume with the separate flag.
      const result = await tool('resume_package', {planId: plan.id, confirm: true});
      assert.equal(result.state, 'complete');
      await record({check: 'explicit-resume-complete', result, status: await tool('repository_status', {planId: plan.id})});
    } finally {controller.abort(); await request;}
  } else {
    const started = performance.now();
    // Eight simultaneous previews exercise shared state without creating eight repositories.
    const plans = await Promise.all(Array.from({length: 8}, (_, i) => tool('preview_package', {owner: 'JuliaPackageFactory', name: `PkgFactoryEdge${run}${i}`, template: templates[i % 3].id, authors: ['PkgFactory staging acceptance'], description: 'PkgFactory.ts Cloudflare acceptance test'})));
    await record({check: 'eight-concurrent-previews', elapsedMs: Math.round(performance.now() - started), plans: plans.map(p => ({id: p.id, repository: p.repository, template: p.spec.template, files: Object.keys(p.files).length}))});
    if (live) for (const plan of plans.slice(0, 3)) {
      // Save the plan before the single write attempt; never retry an uncertain write.
      await record({check: 'create-start', planId: plan.id, repository: plan.repository});
      const start = performance.now();
      const result = await tool('create_package', {planId: plan.id, confirm: true});
      assert.equal(result.state, 'complete');
      await record({check: 'create-complete', planId: plan.id, result, elapsedMs: Math.round(performance.now() - start)});
      const status = await tool('repository_status', {planId: plan.id}); assert.equal(status.state, 'complete');
      await record({check: 'status', status});
    }
  }
  report.completedAt = new Date().toISOString(); await save();
} catch (error) {
  // Do not emit raw SDK errors: OAuth responses can contain credentials.
  report.failed = true; await save();
  console.error(error instanceof assert.AssertionError ? error.message : 'Acceptance stopped. Inspect the saved report and repository status before explicitly resuming.');
  process.exitCode = 1;
} finally {
  if (expiry) clearTimeout(expiry);
  await client.close().catch(() => {});
  listener.close(); tokens = undefined; verifier = '';
}
