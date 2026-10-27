// Interactive staging acceptance. OAuth credentials stay in memory and are never logged.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { escapeHtml } from '../packages/pkgfactory/src/web/http.js';
import { freshTestName, selectedTemplate, SingleCreation } from './e2e/config.js';

const origin = 'https://pkgfactory-staging.ohnolab.workers.dev';
const serverUrl = new URL('/mcp', origin);
const args = process.argv.slice(2);
if (args.some(a => a !== '--confirm-create-test-repository' && !a.startsWith('--template='))) throw new Error('Use the singular --confirm-create-test-repository flag and an optional --template=');
const live = args.includes('--confirm-create-test-repository');
const template = selectedTemplate(args);
const creation = new SingleCreation();
const runName = freshTestName();
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
const report: any = {origin, startedAt: new Date().toISOString(), live, results: []};
const reportPath = `artifacts/staging-mcp-${runName}-${state}.json`;
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
  console.log(`Open ${localOrigin}/ to authorize this test. New repositories: ${live ? 1 : 0}. Report: ${reportPath}`);
  expiry = setTimeout(() => rejectAuthorization(new Error('Authorization timed out after 30 minutes')), 30 * 60000);
  await authorization; clearTimeout(expiry);
  await client.connect(transport);
  const tools = (await client.listTools()).tools.map(t => t.name);
  assert.equal(tools.length, 3); await record({check: 'oauth-and-tools', tools});
  const templates = await tool('list_templates', {}); assert.equal(templates.length, 3);
  const started = performance.now();
  // Preview all templates, but create only the first plan's single repository.
  const plans = await Promise.all(Array.from({length: 8}, (_, i) => tool('preview_package', {owner: 'JuliaPackageFactory', name: runName, template: i === 0 ? template : templates[i % 3].id, authors: ['PkgFactory staging acceptance'], description: 'PkgFactory.ts Cloudflare acceptance test'})));
  await record({check: 'eight-concurrent-previews', elapsedMs: Math.round(performance.now() - started), plans: plans.map(p => ({id: p.id, repository: p.repository, template: p.spec.template, files: Object.keys(p.files).length}))});
  if (live) {
    const plan = plans[0];
    // Record the plan before the single write attempt; never retry an uncertain write.
    await record({check: 'create-start', planId: plan.id, repository: plan.repository});
    const start = performance.now();
    const result = await creation.run(plan.repository, () => tool('create_package', {...plan.spec, plan: {id: plan.id, uuid: plan.uuid, createdAt: plan.createdAt}, confirm: true}));
    assert.equal(result.state, 'complete');
    await record({check: 'create-complete', planId: plan.id, result, elapsedMs: Math.round(performance.now() - start)});
  }
  report.completedAt = new Date().toISOString(); await save();
} catch (error) {
  // Do not emit raw SDK errors: OAuth responses can contain credentials.
  report.failed = true; await save();
  console.error(error instanceof assert.AssertionError ? error.message : 'Acceptance stopped. Inspect the saved report and the repository on GitHub.');
  process.exitCode = 1;
} finally {
  if (expiry) clearTimeout(expiry);
  await client.close().catch(() => {});
  listener.close(); tokens = undefined; verifier = '';
}
