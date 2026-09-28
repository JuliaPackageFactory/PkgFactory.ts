import { escapeHtml as e } from '../../../packages/pkgfactory/src/web/http.js';

export function consentNotices(clientId: string, redirectUri: string): string {
  const redirect = new URL(redirectUri);
  const host = redirect.hostname.toLowerCase();
  const loopback = host === 'localhost' || host.endsWith('.localhost') || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
  let notices = loopback ? '<p role="note"><strong>Local application:</strong> This return address points to your own device. Approve only if you started this connection in an application you trust.</p>' : '';
  if (clientId.startsWith('https://')) {
    const metadata = new URL(clientId);
    // Derive identity from the validated CIMD client_id, never client_uri or
    // client_name supplied inside its metadata document.
    notices += `<p>Client metadata domain: <strong>${e(metadata.hostname)}</strong></p><p>Metadata document: ${e(clientId)}</p>`;
  }
  return notices;
}
