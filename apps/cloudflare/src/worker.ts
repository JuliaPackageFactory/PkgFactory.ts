import OAuthProvider from '@cloudflare/workers-oauth-provider';
import { Factory } from '../../../packages/pkgfactory/src/application/engine.js';
import { api } from '../../../packages/pkgfactory/src/web/routes.js';
import { page } from '../../../packages/pkgfactory/src/web/page.js';
import { json, errorResponse, limitedBody } from '../../../packages/pkgfactory/src/web/http.js';
import assets from '../../../packages/pkgfactory/src/web/assets.json' with {type: 'json'};
import { mcpHttp } from '../../../packages/pkgfactory/src/mcp/server.js';
import { webAuth, session, type Env } from './auth.js';
import { oauthRoutes, refreshGitHub } from './oauth.js';
import { DurableStore } from './state.js';
import { connectedJson } from './connection.js';
export { ApplicationState, AuthState } from './state.js';
const factory = (env: Env, subject: string, beforeRequest?: () => Promise<void>) => new Factory(new DurableStore(env.STATE, subject), {algorithm: env.KEY_ALGORITHM ?? 'ed25519', beforeRequest});
async function web(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const oauth = await oauthRoutes(request, env); if (oauth) return oauth;
  const auth = await webAuth(request, env); if (auth) return auth;
  if (url.pathname === '/health' && request.method === 'GET') return json({service: 'PkgFactory', status: env.MAINTENANCE === 'true' ? 'maintenance' : 'ok'});
  if (url.pathname === '/app.js' && request.method === 'GET') return new Response(assets.js, {headers: {'Content-Type': 'text/javascript'}});
  if (url.pathname === '/style.css' && request.method === 'GET') return new Response(assets.css, {headers: {'Content-Type': 'text/css'}});
  if (url.pathname === '/assets/logo.svg' && request.method === 'GET') return new Response(assets.logo, {headers: {'Content-Type': 'image/svg+xml'}});
  const identity = await session(request, env);
  if (url.pathname === '/' && request.method === 'GET') return new Response(page(identity?.csrf ?? '', true, !!identity), {headers: {'Content-Type': 'text/html; charset=utf-8'}});
  if (url.pathname.startsWith('/api/')) {
    if (!identity) return json({error: 'Connect GitHub to save and execute a preview'}, 401);
    if (request.method !== 'GET' && (request.headers.get('origin') !== env.ORIGIN || request.headers.get('x-pkgfactory-csrf') !== identity.csrf)) return json({error: 'Invalid CSRF token or Origin'}, 403);
    if (url.pathname === '/api/create' || url.pathname === '/api/resume') return connectedJson(request, (signal, check) => api(new Request(request, {signal}), factory(env, identity.subject, check), identity.subject, () => identity));
    return api(request, factory(env, identity.subject), identity.subject, () => identity);
  }
  return json({error: 'Not found'}, 404);
}
function oauthProvider(env: Env) {return new OAuthProvider<Env>({
  apiRoute: '/mcp',
  apiHandler: {async fetch(request, env, ctx) {
    const props = ctx.props as {userId: string; githubToken: string};
    if (request.method !== 'POST') return mcpHttp(request, factory(env, props.userId), {subject: props.userId, token: props.githubToken});
    // Notifications and protocol handshakes retain SDK status/header semantics.
    const payload = await request.clone().json() as any;
    if (payload.method !== 'tools/call') return mcpHttp(request, factory(env, props.userId), {subject: props.userId, token: props.githubToken});
    return connectedJson(request, (signal, check) => mcpHttp(new Request(request, {signal}), factory(env, props.userId, check), {subject: props.userId, token: props.githubToken}));
  }},
  defaultHandler: {fetch: web}, authorizeEndpoint: '/authorize', tokenEndpoint: '/oauth/token', clientRegistrationEndpoint: '/oauth/register',
  scopesSupported: ['pkgfactory'], resourceMetadata: {resource: env.ORIGIN + '/mcp', scopes_supported: ['pkgfactory']},
  allowPlainPKCE: false, allowImplicitFlow: false, accessTokenTTL: 3600, refreshTokenTTL: 8 * 3600,
  clientIdMetadataDocumentEnabled: true, tokenExchangeCallback: refreshGitHub,
});}
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.origin !== env.ORIGIN) return json({error: 'Invalid host'}, 403);
      const origin = request.headers.get('origin');
      if (origin && origin !== env.ORIGIN) return json({error: 'Invalid Origin'}, 403);
      if (url.pathname !== '/health' && (!env.SESSION_KEY || !env.GITHUB_OAUTH_CLIENT_SECRET || !env.GITHUB_OAUTH_CLIENT_ID || env.GITHUB_OAUTH_CLIENT_ID === 'CONFIGURE_ME')) return json({error: 'GitHub OAuth is not configured'}, 503);
      if (env.MAINTENANCE === 'true' && (url.pathname === '/mcp' || url.pathname === '/api/create' || url.pathname === '/api/resume')) return json({error: 'Maintenance: creation is temporarily paused'}, 503);
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
