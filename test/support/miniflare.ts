import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { resolve } from 'node:path';
// The production compatibility settings from wrangler.jsonc.
const runtime = {modules: true as const, compatibilityDate: '2026-09-27', compatibilityFlags: ['enable_request_signal', 'global_fetch_strictly_public']};
const limitNames = ['SOURCE_RATE_LIMIT', 'REGISTRATION_RATE_LIMIT', 'ACCOUNT_RATE_LIMIT'] as const;
export type Limits = Record<typeof limitNames[number], number>;
/** A bundled test entry (poc-worker, factory-worker) running under workerd. */
export const workerd = (script: string, extra: object = {}) => new Miniflare(convertV4MiniflareOptions({...runtime, script, ...extra}));
/** The built Worker with its bindings. Functional tests keep generous limits; security tests exhaust them. */
export function worker(bindings: Record<string, string> = {}, limits: Partial<Limits> = {}, outboundService?: (request: any) => Promise<Response>) {
  const ratelimits = Object.fromEntries(limitNames.map((name, i) => [name, {namespace_id: String(i + 1), simple: {limit: limits[name] ?? 1000, period: 60 as const}}]));
  return new Miniflare(convertV4MiniflareOptions({...runtime, scriptPath: resolve('dist/cloudflare/worker.js'), ratelimits,
    durableObjects: {AUTH: {className: 'AuthState', useSQLite: true}}, kvNamespaces: ['OAUTH_KV'],
    bindings: {ORIGIN: 'https://pkgfactory.test', GITHUB_OAUTH_CLIENT_ID: 'test-client', GITHUB_OAUTH_CLIENT_SECRET: 'test-secret', SESSION_KEY: btoa('a'.repeat(32)), ...bindings},
    ...(outboundService ? {outboundService} : {})}));
}
