import { Factory, type Credentials } from '../application/engine.js';
import { listTemplates } from '../core/spec.js';
import { restorePlan } from '../core/plan.js';
import { json, readJson } from './http.js';
export async function api(request: Request, factory: Factory, credentials: () => Credentials) {
  const path = new URL(request.url).pathname;
  if (path === '/api/templates' && request.method === 'GET') return json(listTemplates());
  if (path === '/api/github/profile' && request.method === 'GET') return json(await factory.githubProfile(credentials(), request.signal));
  if (path === '/api/github/apps' && request.method === 'POST') return json(await factory.githubApps(await readJson(request), credentials(), request.signal));
  if (path === '/api/github/availability' && request.method === 'POST') return json(await factory.repositoryAvailability(await readJson(request), credentials(), request.signal));
  if (path === '/api/preview' && request.method === 'POST') return json(await factory.previewForAccount(await readJson(request), credentials(), request.signal));
  if (path === '/api/create' && request.method === 'POST') {
    const data = await readJson(request);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return json({error: 'Invalid request input'}, 400);
    // The browser sends back the previewed settings and the plan's fixed values;
    // the files are regenerated from them, so no plan is stored on the server.
    const {plan, confirm, ...spec} = data;
    if (confirm !== true) return json({error: 'Explicit confirmation is required'}, 400);
    return json(await factory.execute(await restorePlan(spec, plan), credentials(), request.signal));
  }
  return json({error: 'Not found'}, 404);
}
