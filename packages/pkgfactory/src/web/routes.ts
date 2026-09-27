import { Factory, type Credentials } from '../application/engine.js';
import { listTemplates } from '../core/spec.js';
import { json, readJson } from './http.js';
export async function api(request: Request, factory: Factory, subject: string, credentials: () => Credentials) {
  const path = new URL(request.url).pathname;
  if (path === '/api/templates' && request.method === 'GET') return json(listTemplates());
  if (path === '/api/preview' && request.method === 'POST') return json(await factory.preview(await readJson(request), subject));
  if (['/api/create', '/api/resume', '/api/status'].includes(path) && request.method === 'POST') {
    const data = await readJson(request);
    if (typeof data.planId !== 'string' || !/^[a-f0-9-]{36}$/.test(data.planId)) return json({error: 'Valid planId required'}, 400);
    if (path === '/api/status') return json(await factory.status(data.planId, credentials(), request.signal));
    if (data.confirm !== true) return json({error: 'Explicit confirmation is required'}, 400);
    return json(await factory.execute(data.planId, credentials(), path === '/api/resume', request.signal));
  }
  return json({error: 'Not found'}, 404);
}
