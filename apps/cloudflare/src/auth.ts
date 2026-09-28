import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { base64, base64url, unbase64, randomToken, sha256, utf8, decode } from '../../../packages/pkgfactory/src/core/encoding.js';
import { GitHub } from '../../../packages/pkgfactory/src/github/client.js';
import { json } from '../../../packages/pkgfactory/src/web/http.js';
import { FactoryError } from '../../../packages/pkgfactory/src/application/engine.js';
export interface Env {
  STATE: DurableObjectNamespace; AUTH: DurableObjectNamespace; OAUTH_KV: KVNamespace; OAUTH_PROVIDER: OAuthHelpers;
  ORIGIN: string; GITHUB_OAUTH_CLIENT_ID: string; GITHUB_OAUTH_CLIENT_SECRET: string; SESSION_KEY: string;
  KEY_ALGORITHM?: 'ed25519' | 'rsa4096'; MAINTENANCE?: string;
}
export interface Session {subject: string; token: string; csrf: string}
const cookie = (name: string, value: string, maxAge: number) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
export const cookieValue = (request: Request, name: string) => request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(name + '='))?.slice(name.length + 1);
async function authState(env: Env, action: string, key: string, value?: unknown, ttl?: number) {
  const stub = env.AUTH.get(env.AUTH.idFromName('auth-v1'));
  const response = await stub.fetch('https://auth.internal/', {method: 'POST', body: JSON.stringify({action, key, value, ttl})});
  if (!response.ok) throw new Error('Authentication state unavailable');
  return await response.json() as any;
}
export async function encrypt(env: Pick<Env, 'SESSION_KEY'>, value: unknown, context: string) {
  const key = await crypto.subtle.importKey('raw', unbase64(env.SESSION_KEY), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv, additionalData: utf8(context)}, key, utf8(JSON.stringify(value))));
  return {iv: base64(iv), data: base64(data)};
}
export async function decrypt(env: Pick<Env, 'SESSION_KEY'>, value: {iv: string; data: string}, context: string) {
  const key = await crypto.subtle.importKey('raw', unbase64(env.SESSION_KEY), 'AES-GCM', false, ['decrypt']);
  return JSON.parse(decode(new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: unbase64(value.iv), additionalData: utf8(context)}, key, unbase64(value.data)))));
}
export async function session(request: Request, env: Env): Promise<Session | null> {
  const id = cookieValue(request, '__Host-pkgfactory-session'); if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
  const key = `session:${await sha256(id)}`; const saved = await authState(env, 'get', key);
  if (!saved) return null;
  return decrypt(env, saved, key);
}
export async function githubAuthorize(env: Env, state: string, verifier: string, callback: string) {
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(verifier))));
  const url = new URL('https://github.com/login/oauth/authorize');
  url.search = new URLSearchParams({client_id: env.GITHUB_OAUTH_CLIENT_ID, redirect_uri: env.ORIGIN + callback, scope: 'repo workflow read:user read:org', state, code_challenge: challenge, code_challenge_method: 'S256'}).toString();
  return url.href;
}
export async function exchangeGitHub(request: Request, env: Env, verifier: string, callback: string, fetcher: typeof fetch = fetch): Promise<Session> {
  const url = new URL(request.url);
  if (url.searchParams.has('error')) throw new FactoryError('oauth_denied', 'GitHub authorization was not granted. Start sign-in again.', 400);
  const code = url.searchParams.get('code'); if (!code) throw new FactoryError('oauth_code_missing', 'GitHub authorization code missing. Start sign-in again.', 400);
  if (url.searchParams.has('iss') && url.searchParams.get('iss') !== 'https://github.com/login/oauth') throw new FactoryError('oauth_issuer', 'Unexpected GitHub authorization issuer. Start sign-in again.', 400);
  let result: Response;
  try {
    result = await fetcher('https://github.com/login/oauth/access_token', {method: 'POST', headers: {Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'PkgFactory'}, body: new URLSearchParams({client_id: env.GITHUB_OAUTH_CLIENT_ID, client_secret: env.GITHUB_OAUTH_CLIENT_SECRET, code, code_verifier: verifier, redirect_uri: env.ORIGIN + callback}), redirect: 'manual', signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)])});
  } catch {throw new FactoryError('oauth_exchange_network', 'GitHub token exchange could not be completed. Start sign-in again.', 502);}
  if (result.status >= 300 && result.status < 400) throw new FactoryError('oauth_exchange_redirect', 'GitHub token exchange returned an unexpected redirect. Authorization stopped without following it.', 502);
  let tokens: any;
  try {tokens = await result.json();}
  catch {throw new FactoryError('oauth_exchange_response', 'GitHub returned an invalid token response. Start sign-in again.', 502);}
  // Only fixed messages/codes are exposed. Never log a token response, code or secret.
  if (!result.ok || typeof tokens?.access_token !== 'string') {
    if (tokens?.error === 'incorrect_client_credentials') throw new FactoryError('oauth_client_credentials', 'GitHub rejected the OAuth client credentials. The operator must check the Client ID and matching Client secret.', 502);
    if (tokens?.error === 'redirect_uri_mismatch') throw new FactoryError('oauth_redirect_uri', 'GitHub rejected the callback URL. The operator must check the registered OAuth callback URLs.', 502);
    if (tokens?.error === 'bad_verification_code') throw new FactoryError('oauth_code_invalid', 'GitHub authorization code expired, was already used, or failed verification. Start sign-in again.', 400);
    throw new FactoryError('oauth_exchange_rejected', 'GitHub rejected the token exchange. Start sign-in again.', 502);
  }
  const scopes = String(tokens.scope).split(/[ ,]+/); if (!scopes.includes('repo') || !scopes.includes('workflow')) throw new FactoryError('oauth_scopes', 'GitHub repository and workflow permissions are required. Start sign-in again and grant both permissions.', 403);
  let user: any;
  try {user = await new GitHub(tokens.access_token, request.signal, fetcher).request('GET', '/user');}
  catch {throw new FactoryError('oauth_identity_request', 'The GitHub token could not read your identity. Start sign-in again.', 502);}
  if (!Number.isSafeInteger(user?.id)) throw new FactoryError('oauth_identity_invalid', 'GitHub returned an invalid identity. Start sign-in again.', 502);
  return {subject: String(user.id), token: tokens.access_token, csrf: randomToken()};
}
export async function webAuth(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/auth/login' && request.method === 'GET') {
    const state = randomToken(), browser = randomToken(), verifier = randomToken();
    const key = `pending:${await sha256(state)}`;
    await authState(env, 'put', key, await encrypt(env, {browser: await sha256(browser), verifier}, key), 600000);
    return new Response(null, {status: 302, headers: {Location: await githubAuthorize(env, state, verifier, '/auth/callback'), 'Set-Cookie': cookie('__Host-pkgfactory-login', browser, 600)}});
  }
  if (url.pathname === '/auth/callback' && request.method === 'GET') {
    const state = url.searchParams.get('state'), browser = cookieValue(request, '__Host-pkgfactory-login');
    if (!state || !browser) return json({error: 'Invalid OAuth state'}, 400);
    const key = `pending:${await sha256(state)}`;
    const saved = await authState(env, 'take', key); if (!saved) return json({error: 'Expired or reused OAuth state'}, 400);
    const pending = await decrypt(env, saved, key);
    if (pending.browser !== await sha256(browser)) return json({error: 'OAuth browser mismatch'}, 400);
    const value = await exchangeGitHub(request, env, pending.verifier, '/auth/callback');
    const id = randomToken(); const sessionKey = `session:${await sha256(id)}`;
    await authState(env, 'put', sessionKey, await encrypt(env, value, sessionKey), 8 * 3600000);
    const headers = new Headers({Location: env.ORIGIN + '/'});
    headers.append('Set-Cookie', cookie('__Host-pkgfactory-session', id, 8 * 3600)); headers.append('Set-Cookie', cookie('__Host-pkgfactory-login', '', 0));
    return new Response(null, {status: 302, headers});
  }
  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    const value = await session(request, env);
    if (!value || request.headers.get('origin') !== env.ORIGIN || request.headers.get('x-pkgfactory-csrf') !== value.csrf) return json({error: 'Invalid CSRF token'}, 403);
    await authState(env, 'delete', `session:${await sha256(cookieValue(request, '__Host-pkgfactory-session')!)}`);
    const response = json({ok: true}); response.headers.set('Set-Cookie', cookie('__Host-pkgfactory-session', '', 0)); return response;
  }
  return null;
}
