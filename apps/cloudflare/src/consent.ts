import type { ClientRegistrationCallbackOptions, ClientRegistrationCallbackResult } from '@cloudflare/workers-oauth-provider';
import { escapeHtml as e } from '../../../packages/pkgfactory/src/web/http.js';
import { ipv4Address, ipv6Words } from './ip.js';
import { securityEvent } from './limits.js';
export const redirectPolicy = 'Use an HTTPS, loopback, or native application return address.';

function loopback(redirect: URL) {
  const host = redirect.hostname.toLowerCase().replace(/\.$/, '');
  const v4 = ipv4Address(host), v6 = ipv6Words(host);
  return host === 'localhost' || host.endsWith('.localhost') || !!v4?.startsWith('127.') || v4 === '0.0.0.0' || (!!v6?.slice(0, 7).every(n => n === 0) && v6[7] <= 1);
}
/** OAuth 2.1 and MCP authorization permit plain HTTP only for the user's own device.
 * HTTPS and native application schemes remain available. */
export function redirectAllowed(redirectUri: string): boolean {
  if (!URL.canParse(redirectUri)) return false;
  const redirect = new URL(redirectUri);
  return redirect.protocol !== 'http:' || loopback(redirect);
}
/** Dynamic registration stores only redirect URIs that consent may later accept. */
export function registrationPolicy({clientMetadata, request}: ClientRegistrationCallbackOptions): ClientRegistrationCallbackResult | void {
  const uris = clientMetadata.redirect_uris;
  if (Array.isArray(uris) && uris.every(uri => typeof uri === 'string' && redirectAllowed(uri))) return;
  securityEvent('registration_rejected', request);
  return {description: redirectPolicy};
}
export function consentNotices(clientId: string, redirectUri: string): string {
  const redirect = new URL(redirectUri);
  let notices = loopback(redirect) ? '<p role="note"><strong>Local application:</strong> This return address points to your own device. Approve only if you started this connection in an application you trust.</p>' : '';
  if (!['https:', 'http:'].includes(redirect.protocol)) notices += '<p role="note"><strong>Native application:</strong> This custom return address may open an application on your device. Approve only if you started this connection in an application you trust.</p>';
  const metadata = URL.canParse(clientId) ? new URL(clientId) : undefined;
  if (metadata?.protocol === 'https:') {
    // Derive identity from the validated CIMD client_id, never client_uri or
    // client_name supplied inside its metadata document.
    notices += `<p>Client metadata domain: <strong>${e(metadata.hostname)}</strong></p><p>Metadata document: ${e(clientId)}</p>`;
  }
  return notices;
}
