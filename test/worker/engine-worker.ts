import { ApplicationState, DurableStore } from '../../apps/cloudflare/src/state.js';
import { Factory } from '../../packages/pkgfactory/src/application/engine.js';
import { FakeGitHub } from '../fake-github.js';
import { connectedJson } from '../../apps/cloudflare/src/connection.js';
export {ApplicationState};
const remote = new FakeGitHub();
let delayed = false;
export default {async fetch(request: Request, env: {STATE: DurableObjectNamespace}) {
  const path = new URL(request.url).pathname;
  if (path === '/calls') return Response.json(remote.calls.map(c => ({method: c.method, path: c.path})));
  const body = await request.json() as any;
  let checkConnection: (() => Promise<void>) | undefined;
  const factory = new Factory(new DurableStore(env.STATE, '42'), {beforeRequest: () => checkConnection?.() ?? Promise.resolve(), fetcher: async (input, init) => {
    const response = await remote.fetch(input, init);
    if (delayed && String(input).endsWith('/git/trees')) await new Promise(r => setTimeout(r, 500));
    return response;
  }});
  if (path === '/preview') return Response.json(await factory.preview(body, '42'));
  if (path === '/cancel-test') delayed = true;
  request.signal.addEventListener('abort', () => {remote.calls.push({method: 'SIGNAL', path: 'aborted', body: null});});
  return connectedJson(request, async (signal, check) => {checkConnection = check; return Response.json(await factory.execute(body.planId, {token: 'test', subject: '42'}, false, signal));});
}};
