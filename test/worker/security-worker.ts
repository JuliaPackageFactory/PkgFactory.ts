// Test-only diagnostics and engine entry point; never part of the deployed bundle.
import { ApplicationState as ProductionState, AuthState as ProductionAuth, DurableStore } from '../../apps/cloudflare/src/state.js';
import { Factory } from '../../packages/pkgfactory/src/application/engine.js';
import { FakeGitHub } from '../fake-github.js';
import { errorResponse } from '../../packages/pkgfactory/src/web/http.js';
export class ApplicationState extends ProductionState {
  override async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path === '/expire') {await this.alarm(); return Response.json({ok: true});}
    if (path === '/stats') return Response.json({count: this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM operations_v2').one().n, legacy: [...(await this.ctx.storage.list()).keys()]});
    return super.fetch(request);
  }
}
export class AuthState extends ProductionAuth {
  override async fetch(request: Request) {
    if (new URL(request.url).pathname === '/stats') return Response.json({count: this.ctx.storage.sql.exec('SELECT COUNT(*) AS n FROM auth_v2').one().n, legacy: [...(await this.ctx.storage.list()).keys()]});
    return super.fetch(request);
  }
}
const remote = new FakeGitHub();
export default {async fetch(request: Request, env: {STATE: DurableObjectNamespace}) {
  try {
    const path = new URL(request.url).pathname;
    if (path === '/calls') return Response.json(remote.calls);
    const body = await request.json() as any;
    const factory = new Factory(new DurableStore(env.STATE, body.subject), {fetcher: remote.fetch});
    if (path === '/preview') return Response.json(await factory.preview({owner: 'tester', name: body.name ?? 'Capacity', authors: ['Tester'], template: 'minimum'}, body.subject));
    if (path === '/fill') {
      for (let user = 0; user < 17; user++) for (let plan = 0; plan < 16; plan++) await new Factory(new DurableStore(env.STATE, `user-${user}`)).preview({owner: 'tester', name: 'Capacity', authors: ['Tester'], template: 'minimum'}, `user-${user}`);
      return Response.json({ok: true});
    }
    return Response.json(await factory.execute(body.planId, {subject: body.subject, token: 'test'}, body.resume ?? false));
  } catch (error) {return errorResponse(error);}
}};
