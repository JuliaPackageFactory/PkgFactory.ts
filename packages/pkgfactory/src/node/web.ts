import { createServer } from 'node:http';
import { Factory, FactoryError } from '../application/engine.js';
import { api } from '../web/routes.js';
import { page } from '../web/page.js';
import { json, errorResponse } from '../web/http.js';
import assets from '../web/assets.json' with {type: 'json'};
import { randomToken } from '../core/encoding.js';
export async function localWeb(factory: Factory, token: string | undefined, port = 8787, parentSignal?: AbortSignal) {
  const csrf = randomToken();
  let origin = '';
  const server = createServer(async (incoming, outgoing) => {
    const abort = new AbortController();
    incoming.on('aborted', () => abort.abort());
    outgoing.on('close', () => {if (!outgoing.writableEnded) abort.abort();});
    const signal = parentSignal ? AbortSignal.any([abort.signal, parentSignal]) : abort.signal;
    try {
      if (incoming.headers.host !== new URL(origin).host) throw new FactoryError('host', 'Invalid Host', 403);
      if (incoming.headers.origin && incoming.headers.origin !== origin) throw new FactoryError('origin', 'Invalid Origin', 403);
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of incoming) {size += chunk.length; if (size > 131072) throw new FactoryError('size', 'Request too large', 413); chunks.push(chunk);}
      const headers = new Headers(); for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      const request = new Request(new URL(incoming.url!, origin), {method: incoming.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, signal});
      const path = new URL(request.url).pathname;
      let response: Response;
      if (request.method === 'GET' && path === '/') response = new Response(page(csrf, false, !!token), {headers: {'Content-Type': 'text/html; charset=utf-8'}});
      else if (request.method === 'GET' && path === '/app.js') response = new Response(assets.js, {headers: {'Content-Type': 'text/javascript'}});
      else if (request.method === 'GET' && path === '/style.css') response = new Response(assets.css, {headers: {'Content-Type': 'text/css'}});
      else if (path.startsWith('/api/')) {
        if (request.method !== 'GET' && (headers.get('origin') !== origin || headers.get('x-pkgfactory-csrf') !== csrf)) throw new FactoryError('csrf', 'Invalid CSRF token or Origin', 403);
        response = await api(request, factory, 'local', () => {if (!token) throw new FactoryError('auth', 'Start pkgfactory web with GITHUB_TOKEN, --device, or --gh', 401); return {token, subject: 'local'};});
      } else response = json({error: 'Not found'}, 404);
      response.headers.set('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
      response.headers.set('Referrer-Policy', 'no-referrer'); response.headers.set('Cache-Control', 'no-store'); response.headers.set('X-Content-Type-Options', 'nosniff');
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      if (!outgoing.destroyed) {const response = errorResponse(error); outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(await response.text());}
    }
  });
  await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve());});
  origin = `http://127.0.0.1:${(server.address() as any).port}`;
  parentSignal?.addEventListener('abort', () => {server.close(); server.closeAllConnections();}, {once: true});
  return {server, origin};
}
