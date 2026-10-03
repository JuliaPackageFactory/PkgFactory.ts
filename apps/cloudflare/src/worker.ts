import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { Factory } from '../../../packages/pkgfactory/src/application/engine.js';
import { api } from '../../../packages/pkgfactory/src/web/routes.js';
import { page } from '../../../packages/pkgfactory/src/web/page.js';
import { json, errorResponse, limitedBody, readJson } from '../../../packages/pkgfactory/src/web/http.js';
import assets from '../../../packages/pkgfactory/src/web/assets.json' with {type: 'json'};
import { unbase64 } from '../../../packages/pkgfactory/src/core/encoding.js';
import { mcpHttp } from '../../../packages/pkgfactory/src/mcp/server.js';
import { webAuth, session, sessionKeyValid, type Env } from './auth.js';
import { oauthRoutes, refreshGitHub } from './oauth.js';
import { registrationPolicy } from './consent.js';
import { DurableStore } from './state.js';
import { connectedJson } from './connection.js';
import { suggestTemplate } from './template-suggestion.js';
import { limited, securityEvent, sourceKey } from './limits.js';
export { ApplicationState, AuthState } from './state.js';
const factory = (env: Env, subject: string, beforeRequest?: () => Promise<void>) => new Factory(new DurableStore(env.STATE, subject), {algorithm: env.KEY_ALGORITHM ?? 'ed25519', beforeRequest});
// Anonymous routes that write OAuth KV/AuthState or call GitHub. Web and MCP
// requests from one GitHub account share ACCOUNT_RATE_LIMIT instead.
const anonymousRoutes = new Set(['/authorize', '/callback', '/oauth/token', '/oauth/register', '/auth/login', '/auth/callback', '/auth/logout']);
const accountLimit = (env: Env, subject: string, request: Request) => limited(env.ACCOUNT_RATE_LIMIT, `subject:${subject}`, request);
const rpcError = (code: number, message: string) => json({jsonrpc: '2.0', id: null, error: {code, message}}, 400);
async function web(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const oauth = await oauthRoutes(request, env); if (oauth) return oauth;
  const auth = await webAuth(request, env); if (auth) return auth;
  if (url.pathname === '/health' && request.method === 'GET') return json({service: 'PkgFactory', status: env.MAINTENANCE === 'true' ? 'maintenance' : 'ok'});
  if (url.pathname === '/app.js' && request.method === 'GET') return new Response(assets.js, {headers: {'Content-Type': 'text/javascript'}});
  if (url.pathname === '/style.css' && request.method === 'GET') return new Response(assets.css, {headers: {'Content-Type': 'text/css'}});
  if (url.pathname === '/assets/logo.svg' && request.method === 'GET') return new Response(assets.logo, {headers: {'Content-Type': 'image/svg+xml'}});
  if (url.pathname === '/assets/github.svg' && request.method === 'GET') return new Response(assets.github, {headers: {'Content-Type': 'image/svg+xml'}});
  if (url.pathname === '/assets/hero.png' && request.method === 'GET') return new Response(unbase64(assets.hero), {headers: {'Content-Type': 'image/png'}});
  const identity = await session(request, env);
  if (url.pathname === '/' && request.method === 'GET') return new Response(page(identity?.csrf ?? '', true, !!identity, !!env.AI), {headers: {'Content-Type': 'text/html; charset=utf-8'}});
  if (url.pathname.startsWith('/api/')) {
    if (!identity) return json({error: 'Connect GitHub to save and execute a preview'}, 401);
    if (request.method !== 'GET' && (request.headers.get('origin') !== env.ORIGIN || request.headers.get('x-pkgfactory-csrf') !== identity.csrf)) {securityEvent('csrf_rejected', request); return json({error: 'Invalid CSRF token or Origin'}, 403);}
    const limit = await accountLimit(env, identity.subject, request); if (limit) return limit;
    if (url.pathname === '/api/template-suggestion' && request.method === 'POST') return json(await suggestTemplate(env.AI, await readJson(request)));
    if (url.pathname === '/api/create' || url.pathname === '/api/resume') return connectedJson(request, (signal, check) => api(new Request(request, {signal}), factory(env, identity.subject, check), identity.subject, () => identity));
    return api(request, factory(env, identity.subject), identity.subject, () => identity);
  }
  return json({error: 'Not found'}, 404);
}
function oauthProvider(env: Env) {return new OAuthProvider<Env>({
  apiRoute: '/mcp',
  apiHandler: {async fetch(request, env, ctx) {
    const props = ctx.props as {userId: string; githubToken: string};
    const limit = await accountLimit(env, props.userId, request); if (limit) return limit;
    if (request.method !== 'POST') return mcpHttp(request, factory(env, props.userId), {subject: props.userId, token: props.githubToken});
    let payload: any;
    try {payload = await request.clone().json();} catch {return rpcError(-32700, 'Parse error');}
    // A batch would carry tools/call past the disconnect guard below. MCP
    // 2025-06-18 removed JSON-RPC batching; the SDK still accepts arrays.
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return rpcError(-32600, 'Send one JSON-RPC message per request.');
    // Notifications and protocol handshakes retain SDK status/header semantics.
    if (payload.method !== 'tools/call') return mcpHttp(request, factory(env, props.userId), {subject: props.userId, token: props.githubToken});
    return connectedJson(request, (signal, check) => mcpHttp(new Request(request, {signal}), factory(env, props.userId, check), {subject: props.userId, token: props.githubToken}));
  }},
  defaultHandler: {fetch: web}, authorizeEndpoint: '/authorize', tokenEndpoint: '/oauth/token', clientRegistrationEndpoint: '/oauth/register',
  scopesSupported: ['pkgfactory'], resourceMetadata: {resource: env.ORIGIN + '/mcp', scopes_supported: ['pkgfactory']},
  allowPlainPKCE: false, allowImplicitFlow: false, accessTokenTTL: 3600, refreshTokenTTL: 8 * 3600,
  clientIdMetadataDocumentEnabled: true, tokenExchangeCallback: refreshGitHub, clientRegistrationCallback: registrationPolicy,
  // The default log includes descriptions that can echo client input. Keep fixed identifiers only.
  onError: ({status, code, internal}) => {console.warn(JSON.stringify({event: 'oauth_error', status, code, category: internal?.category, reason: internal?.reason}));},
});}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.origin !== env.ORIGIN) {securityEvent('host_rejected', request); return json({error: 'Invalid host'}, 403);}
      const origin = request.headers.get('origin');
      if (origin && origin !== env.ORIGIN) {securityEvent('origin_rejected', request); return json({error: 'Invalid Origin'}, 403);}
      if (url.pathname !== '/health' && (!env.GITHUB_OAUTH_CLIENT_SECRET || !env.GITHUB_OAUTH_CLIENT_ID || env.GITHUB_OAUTH_CLIENT_ID === 'CONFIGURE_ME')) return json({error: 'GitHub OAuth is not configured'}, 503);
      if (url.pathname !== '/health' && !sessionKeyValid(env.SESSION_KEY)) return json({error: 'SESSION_KEY must be 32 bytes of Base64'}, 503);
      if (url.pathname !== '/health' && (!env.SOURCE_RATE_LIMIT || !env.REGISTRATION_RATE_LIMIT || !env.ACCOUNT_RATE_LIMIT)) return json({error: 'Rate limiting is not configured'}, 503);
      if (env.MAINTENANCE === 'true' && (url.pathname === '/mcp' || url.pathname === '/api/create' || url.pathname === '/api/resume')) return json({error: 'Maintenance: creation is temporarily paused'}, 503);
      if (anonymousRoutes.has(url.pathname)) {
        const source = await sourceKey(request, env);
        const limit = await limited(env.SOURCE_RATE_LIMIT, `source:${source}`, request)
          ?? (url.pathname === '/oauth/register' ? await limited(env.REGISTRATION_RATE_LIMIT, `source:${source}`, request) : null);
        if (limit) return limit;
      }
      if (request.body) {
        const body = await limitedBody(request, 131072);
        request = new Request(request.url, {method: request.method, headers: request.headers, body, signal: request.signal});
      }
      const response = await oauthProvider(env).fetch(request, env, ctx);
      const secured = new Response(response.body, response);
      secured.headers.set('Cache-Control', 'no-store, no-transform');
      // no-referrer makes a native form POST send Origin: null. Keep the real
      // Origin for the same-origin consent form, without sending referrers away.
      secured.headers.set('Referrer-Policy', url.pathname === '/authorize' && request.method === 'GET' ? 'same-origin' : 'no-referrer');
      secured.headers.set('X-Content-Type-Options', 'nosniff');
      secured.headers.set('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      return secured;
    } catch (error) {return errorResponse(error);}
  },
};
