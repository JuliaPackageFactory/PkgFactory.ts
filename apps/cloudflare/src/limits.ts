import { sha256 } from '../../../packages/pkgfactory/src/core/encoding.js';
import { loginSource } from './ip.js';
// Cloudflare supplies CF-Connecting-IP at the edge. Limits and logs use only a
// keyed hash of the IPv4 address or IPv6 /64, never the raw address.
export const sourceKey = async (request: Request, env: {SESSION_KEY: string}) => sha256(env.SESSION_KEY + ':' + loginSource(request.headers.get('CF-Connecting-IP')));
/** Record the event name and path only: no query string, address, token or account. */
export function securityEvent(event: string, request: Request) {
  console.warn(JSON.stringify({event, method: request.method, path: new URL(request.url).pathname}));
}
export function tooManyRequests(request: Request) {
  securityEvent('rate_limited', request);
  const message = 'Too many requests. Try again in one minute.';
  // OAuth clients read an error code; the Web and MCP read a message.
  const body = new URL(request.url).pathname.startsWith('/oauth/') ? {error: 'temporarily_unavailable', error_description: message} : {error: message};
  return new Response(JSON.stringify(body), {status: 429, headers: {'Content-Type': 'application/json', 'Retry-After': '60'}});
}
/** Workers Rate Limiting counts per Cloudflare location. It bounds one source's
 * cost; it is not an exact global quota. */
export async function limited(limiter: RateLimit, key: string, request: Request) {
  return (await limiter.limit({key})).success ? null : tooManyRequests(request);
}
