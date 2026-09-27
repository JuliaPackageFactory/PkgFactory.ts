import { AuthorizationError, CimdFetchError, OAuthError, type TokenExchangeCallbackOptions } from '@cloudflare/workers-oauth-provider';
import { json, escapeHtml as e } from '../../../packages/pkgfactory/src/web/http.js';
import { randomToken } from '../../../packages/pkgfactory/src/core/encoding.js';
import { GitHub } from '../../../packages/pkgfactory/src/github/client.js';
import { githubAuthorize, exchangeGitHub, type Env } from './auth.js';
export async function refreshGitHub({grantType, props}: TokenExchangeCallbackOptions) {
  if (grantType !== 'refresh_token') return;
  try {
    const user = await new GitHub(props.githubToken, AbortSignal.timeout(15000)).request('GET', '/user');
    if (String(user.id) !== props.userId) throw new OAuthError('invalid_grant', {description: 'GitHub identity changed'});
  } catch {throw new OAuthError('invalid_grant', {description: 'Reconnect your GitHub account'});}
}
export async function oauthRoutes(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url); const oauth = env.OAUTH_PROVIDER;
  try {
    if (url.pathname === '/authorize' && request.method === 'GET') {
      const auth = await oauth.parseAuthRequest(request); const client = await oauth.lookupClient(auth.clientId);
      const consent = await oauth.beginConsent(auth); consent.headers.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Connect PkgFactory</title><h1>Connect ${e(client?.clientName || auth.clientId)}?</h1><p>Return address: ${e(auth.redirectUri)}</p><p>This client may preview and create Julia repositories using your GitHub account. Its displayed name is not verified. Confirm repository creation in your client.</p><form method="post" action="/authorize"><input type="hidden" name="handle" value="${e(consent.handle)}"><button name="decision" value="approve">Continue to GitHub</button><button name="decision" value="deny">Cancel</button></form></html>`, {headers: consent.headers});
    }
    if (url.pathname === '/authorize' && request.method === 'POST') {
      const form = await request.formData(); const handle = String(form.get('handle'));
      if (form.get('decision') !== 'approve') {const denied = await oauth.denyConsent(request, handle); return new Response(null, {status: 302, headers: denied.headers});}
      const approved = await oauth.approveConsent(request, handle, {scope: ['pkgfactory']});
      const verifier = randomToken(); const {state, headers} = await oauth.beginUpstream(approved.request, {data: {verifier}, headers: approved.headers});
      headers.set('Location', await githubAuthorize(env, state, verifier, '/callback'));
      return new Response(null, {status: 302, headers});
    }
    if (url.pathname === '/callback' && request.method === 'GET') {
      const {request: original, data, headers} = await oauth.finishUpstream(request);
      const identity = await exchangeGitHub(request, env, (data as {verifier: string}).verifier, '/callback');
      const {redirectTo} = await oauth.completeAuthorization({request: original, userId: identity.subject, metadata: {}, scope: original.scope, props: {userId: identity.subject, githubToken: identity.token}});
      headers.set('Location', redirectTo); return new Response(null, {status: 302, headers});
    }
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) return json({error: 'Authorization invalid or expired. Start sign-in again.'}, 400);
    throw error;
  }
  return null;
}
