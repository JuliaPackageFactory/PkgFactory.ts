import { DurableObject } from 'cloudflare:workers';
import type { Operation, StateStore } from '../../../packages/pkgfactory/src/application/state.js';
import { json } from '../../../packages/pkgfactory/src/web/http.js';
// Metadata transactions are compare-and-swap. Large immutable plans are read only
// by their executor, so 8 simultaneous operations don't copy every plan in memory.
function summary(op: Operation): Operation {
  return {...op, plan: {id: op.plan.id, repository: op.plan.repository, digest: op.plan.digest} as Operation['plan']};
}
export class ApplicationState extends DurableObject {
  async fetch(request: Request) {
    const data = await request.json() as any;
    return this.ctx.storage.transaction(async tx => {
      const revision = await tx.get<number>('revision') ?? 0;
      const entries = await tx.get<[string, Operation][]>('operations') ?? [];
      const items = new Map(entries);
      if (data.action === 'snapshot') return json({revision, entries});
      if (data.action === 'get') {
        const op = items.get(data.id); return json(op ? {...op, plan: await tx.get(`plan:${data.id}`)} : null);
      }
      if (data.action === 'cas' && data.revision !== revision) return json({conflict: true}, 409);
      for (const id of data.remove ?? []) {items.delete(id); await tx.delete(`plan:${id}`);}
      for (const op of data.put ?? []) {
        if (op.plan.files) {if (JSON.stringify(op.plan).length > 100000) return json({error: 'Plan too large'}, 413); await tx.put(`plan:${op.plan.id}`, op.plan);}
        items.set(op.plan.id, summary(op));
      }
      await tx.put('operations', [...items]); await tx.put('revision', revision + 1); return json({ok: true});
    });
  }
}
export class DurableStore implements StateStore {
  private stub: DurableObjectStub;
  constructor(namespace: DurableObjectNamespace) {this.stub = namespace.get(namespace.idFromName('pkgfactory-v1'));}
  private async call(data: unknown) {
    const result = await this.stub.fetch('https://state.internal/', {method: 'POST', body: JSON.stringify(data)});
    if (!result.ok && result.status !== 409) throw new Error('State unavailable');
    return result.json() as Promise<any>;
  }
  async get(id: string) {return (await this.call({action: 'get', id})) ?? undefined;}
  async put(op: Operation) {await this.call({action: 'put', put: [op]});}
  async transaction<T>(fn: (items: Map<string, Operation>) => T): Promise<T> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const {revision, entries} = await this.call({action: 'snapshot'});
      const items = new Map<string, Operation>(entries); const before = new Map([...items].map(([id, op]) => [id, JSON.stringify(op)]));
      const value = fn(items);
      const put = [...items].filter(([id, op]) => before.get(id) !== JSON.stringify(op)).map(([, op]) => op);
      const remove = [...before.keys()].filter(id => !items.has(id));
      const result = await this.call({action: 'cas', revision, put, remove}); if (!result.conflict) return value;
    }
    throw new Error('State transaction contention; try again');
  }
}
export class AuthState extends DurableObject {
  async fetch(request: Request) {
    const data = await request.json() as any;
    return this.ctx.storage.transaction(async tx => {
      const all = await tx.list<any>(); const now = Date.now();
      for (const [key, value] of all) if (value.expiresAt <= now) {await tx.delete(key); all.delete(key);}
      if (data.action === 'put') {
        if (all.size >= 4096) return json({error: 'Authentication capacity exceeded'}, 429);
        await tx.put(data.key, {value: data.value, expiresAt: now + data.ttl});
        await this.ctx.storage.setAlarm(now + 600000); return json({ok: true});
      }
      const item = all.get(data.key);
      if (data.action === 'take' || data.action === 'delete') await tx.delete(data.key);
      return json(data.action === 'delete' ? null : item?.value ?? null);
    });
  }
  async alarm() {
    const all = await this.ctx.storage.list<any>(); const now = Date.now();
    for (const [key, value] of all) if (value.expiresAt <= now) await this.ctx.storage.delete(key);
    if ([...all.values()].some(x => x.expiresAt > now)) await this.ctx.storage.setAlarm(now + 600000);
  }
}
