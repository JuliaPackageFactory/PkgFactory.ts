import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { base64, base64url, unbase64, unbase64url, randomToken, sha256, utf8, decode } from '../../../packages/pkgfactory/src/core/encoding.js';
import { GitHub } from '../../../packages/pkgfactory/src/github/client.js';
import { json } from '../../../packages/pkgfactory/src/web/http.js';
import { FactoryError } from '../../../packages/pkgfactory/src/application/engine.js';
import { securityEvent, sourceKey, tooManyRequests } from './limits.js';
export interface Env {
  AI?: Ai;
  STATE: DurableObjectNamespace; AUTH: DurableObjectNamespace; OAUTH_KV: KVNamespace; OAUTH_PROVIDER: OAuthHelpers;
  SOURCE_RATE_LIMIT: RateLimit; REGISTRATION_RATE_LIMIT: RateLimit; ACCOUNT_RATE_LIMIT: RateLimit;
  ORIGIN: string; GITHUB_OAUTH_CLIENT_ID: string; GITHUB_OAUTH_CLIENT_SECRET: string; SESSION_KEY: string;
  KEY_ALGORITHM?: 'ed25519' | 'rsa4096'; MAINTENANCE?: string;
}
export interface Session {subject: string; token: string; csrf: string}
const cookie = (name: string, value: string, maxAge: number) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
const sessionCookie = '__Host-pkgfactory-session';
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
// A separate HMAC key, derived from SESSION_KEY, signs the random session ID.
async function cookieKey(env: Pick<Env, 'SESSION_KEY'>) {
  const base = await crypto.subtle.importKey('raw', unbase64(env.SESSION_KEY), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: utf8('pkgfactory session cookie v1')}, base, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
}
export async function sessionCookieValue(env: Pick<Env, 'SESSION_KEY'>, id: string) {
  return `${id}.${base64url(new Uint8Array(await crypto.subtle.sign('HMAC', await cookieKey(env), utf8(id))))}`;
}
async function loadSession(request: Request, env: Env): Promise<{key: string; value: Session} | null> {
  const signed = cookieValue(request, sessionCookie)?.match(/^([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/); if (!signed) return null;
  // Forged identifiers stop here, before the shared AuthState Durable Object.
  if (!await crypto.subtle.verify('HMAC', await cookieKey(env), unbase64url(signed[2]), utf8(signed[1]))) return null;
  const key = `session:${await sha256(signed[1])}`; const saved = await authState(env, 'get', key);
  if (!saved) return null;
  // A rotated SESSION_KEY or damaged record signs the browser out instead of failing every page.
  try {return {key, value: await decrypt(env, saved, key)};} catch {return null;}
}
export async function session(request: Request, env: Env): Promise<Session | null> {
  return (await loadSession(request, env))?.value ?? null;
}
/** Revoke the Web session's GitHub token. Other sign-ins hold their own tokens.
 * Best effort: logout still deletes the server-side session if GitHub is unavailable. */
export async function revokeGitHub(env: Pick<Env, 'GITHUB_OAUTH_CLIENT_ID' | 'GITHUB_OAUTH_CLIENT_SECRET'>, token: string, fetcher: typeof fetch = fetch) {
  try {
    const response = await fetcher(`https://api.github.com/applications/${encodeURIComponent(env.GITHUB_OAUTH_CLIENT_ID)}/token`, {method: 'DELETE',
      headers: {Authorization: `Basic ${btoa(`${env.GITHUB_OAUTH_CLIENT_ID}:${env.GITHUB_OAUTH_CLIENT_SECRET}`)}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'PkgFactory', 'X-GitHub-Api-Version': '2022-11-28'},
      body: JSON.stringify({access_token: token}), redirect: 'manual', signal: AbortSignal.timeout(10000)});
    // GitHub answers 404 or 422 for a token that already expired or was revoked.
    return response.status === 204;
  } catch {return false;}
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
    // Each source gets its own exact counter, independent of authenticated sessions.
    if (!await authState(env, 'limit', `login-rate:${await sourceKey(request, env)}`, {limit: 20}, 60000)) return tooManyRequests(request);
    const state = randomToken(), verifier = randomToken();
    const encrypted = await encrypt(env, {state, verifier, expiresAt: Date.now() + 600000}, `web-login:${env.ORIGIN}`);
    const browser = base64url(utf8(JSON.stringify(encrypted)));
    return new Response(null, {status: 302, headers: {Location: await githubAuthorize(env, state, verifier, '/auth/callback'), 'Set-Cookie': cookie('__Host-pkgfactory-login', browser, 600)}});
  }
  if (url.pathname === '/auth/callback' && request.method === 'GET') {
    const state = url.searchParams.get('state'), browser = cookieValue(request, '__Host-pkgfactory-login');
    if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !browser || browser.length > 2048) return json({error: 'Invalid OAuth state'}, 400);
    let pending: {state: string; verifier: string; expiresAt: number};
    try {pending = await decrypt(env, JSON.parse(decode(unbase64url(browser))), `web-login:${env.ORIGIN}`);}
    catch {return json({error: 'Invalid OAuth browser state. Start sign-in again.'}, 400);}
    if (pending.state !== state) return json({error: 'OAuth browser mismatch'}, 400);
    if (!Number.isFinite(pending.expiresAt) || pending.expiresAt <= Date.now()) return json({error: 'Expired OAuth state. Start sign-in again.'}, 400);
    // A valid browser-bound callback consumes its state before token exchange.
    // Parallel callbacks and uncertain exchange responses cannot reuse it.
    if (!await authState(env, 'claim', `used:${await sha256(state)}`, undefined, 600000)) return json({error: 'Reused OAuth state. Start sign-in again.'}, 400);
    const value = await exchangeGitHub(request, env, pending.verifier, '/auth/callback');
    const id = randomToken(); const sessionKey = `session:${await sha256(id)}`;
    await authState(env, 'put', sessionKey, await encrypt(env, value, sessionKey), 8 * 3600000);
    const headers = new Headers({Location: env.ORIGIN + '/'});
    headers.append('Set-Cookie', cookie(sessionCookie, await sessionCookieValue(env, id), 8 * 3600)); headers.append('Set-Cookie', cookie('__Host-pkgfactory-login', '', 0));
    return new Response(null, {status: 302, headers});
  }
  if (url.pathname === '/auth/logout' && request.method === 'POST') {
    const current = await loadSession(request, env);
    if (!current) return json({error: 'Invalid CSRF token'}, 403);
    if (request.headers.get('origin') !== env.ORIGIN || request.headers.get('x-pkgfactory-csrf') !== current.value.csrf) {securityEvent('csrf_rejected', request); return json({error: 'Invalid CSRF token'}, 403);}
    const revoked = await revokeGitHub(env, current.value.token);
    if (!revoked) securityEvent('github_revoke_failed', request);
    await authState(env, 'delete', current.key);
    const response = json({ok: true, githubTokenRevoked: revoked}); response.headers.set('Set-Cookie', cookie(sessionCookie, '', 0)); return response;
  }
  return null;
}
