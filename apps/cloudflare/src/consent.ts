import { escapeHtml as e } from '../../../packages/pkgfactory/src/web/http.js';
import { ipv4Address, ipv6Words } from './ip.js';

export function consentNotices(clientId: string, redirectUri: string): string {
  const redirect = new URL(redirectUri);
  const host = redirect.hostname.toLowerCase().replace(/\.$/, '');
  const v4 = ipv4Address(host), v6 = ipv6Words(host);
  const loopback = host === 'localhost' || host.endsWith('.localhost') || v4?.startsWith('127.') || v4 === '0.0.0.0' || (v6?.slice(0, 7).every(n => n === 0) && v6[7] <= 1);
  let notices = loopback ? '<p role="note"><strong>Local application:</strong> This return address points to your own device. Approve only if you started this connection in an application you trust.</p>' : '';
  if (!['https:', 'http:'].includes(redirect.protocol)) notices += '<p role="note"><strong>Native application:</strong> This custom return address may open an application on your device. Approve only if you started this connection in an application you trust.</p>';
  if (redirect.protocol === 'http:' && !loopback) notices += '<p role="note"><strong>Unencrypted return address:</strong> This remote HTTP connection is not encrypted. Prefer a client with an HTTPS return address.</p>';
  const metadata = URL.canParse(clientId) ? new URL(clientId) : undefined;
  if (metadata?.protocol === 'https:') {
    // Derive identity from the validated CIMD client_id, never client_uri or
    // client_name supplied inside its metadata document.
    notices += `<p>Client metadata domain: <strong>${e(metadata.hostname)}</strong></p><p>Metadata document: ${e(clientId)}</p>`;
  }
  return notices;
}
