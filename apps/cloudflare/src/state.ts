import { DurableObject } from 'cloudflare:workers';
import type { Operation, StateStore } from '../../../packages/pkgfactory/src/application/state.js';
import { json } from '../../../packages/pkgfactory/src/web/http.js';
// Metadata transactions are compare-and-swap. Large immutable plans are read only
// by their executor, so 8 simultaneous operations don't copy every plan in memory.
function summary(op: Operation): Operation {
  return {...op, plan: {id: op.plan.id, repository: op.plan.repository, digest: op.plan.digest} as Operation['plan']};
}
async function deleteLegacy(storage: DurableObjectStorage, keys: string[]) {
  for (let i = 0; i < keys.length; i += 128) await storage.delete(keys.slice(i, i + 128));
}
export class ApplicationState extends DurableObject {
  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql;
      sql.exec(`CREATE TABLE IF NOT EXISTS operations_v2 (
        id TEXT PRIMARY KEY, subject TEXT NOT NULL, repository TEXT NOT NULL,
        state TEXT NOT NULL, expires_at INTEGER NOT NULL, lease_until INTEGER NOT NULL,
        metadata TEXT NOT NULL, plan TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS op_subject ON operations_v2(subject);
        CREATE INDEX IF NOT EXISTS op_repository ON operations_v2(repository, state);
        CREATE INDEX IF NOT EXISTS op_running ON operations_v2(state, lease_until);
        CREATE INDEX IF NOT EXISTS op_expiry ON operations_v2(state, expires_at);
        CREATE TABLE IF NOT EXISTS state_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
        INSERT OR IGNORE INTO state_meta VALUES ('revision', 0);`);
      // Preserve existing journals and locks in the same Durable Object. The
      // one-time migration finishes before any request can access the new index.
      const legacy = await ctx.storage.get<[string, Operation][]>('operations');
      if (legacy && !sql.exec("SELECT 1 FROM state_meta WHERE key = 'migrated'").toArray().length) {
        const operations: Operation[] = [];
        for (const [id, op] of legacy) {
          const plan = await ctx.storage.get<Operation['plan']>(`plan:${id}`);
          // Isolate a missing blob without losing its journal/lock or making
          // every other account unavailable. The engine refuses its execution.
          operations.push(plan ? {...op, plan} : {...op, recoveryError: 'missing_plan'});
        }
        ctx.storage.transactionSync(() => {
          for (const op of operations) this.save(op);
          sql.exec("INSERT INTO state_meta VALUES ('migrated', 1)");
        });
      }
      if (legacy) await deleteLegacy(ctx.storage, [...legacy.map(([id]) => `plan:${id}`), 'operations', 'revision']);
      if (!await ctx.storage.getAlarm()) await ctx.storage.setAlarm(Date.now() + 60000);
    });
  }
  private save(op: Operation) {
    const sql = this.ctx.storage.sql;
    const values = [op.subject, op.plan.repository.toLowerCase(), op.state, op.expiresAt, op.leaseUntil ?? 0, JSON.stringify(summary(op))];
    if (op.plan.files || op.recoveryError) sql.exec(`INSERT INTO operations_v2 (subject, repository, state, expires_at, lease_until, metadata, id, plan)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET
      state=excluded.state, expires_at=excluded.expires_at, lease_until=excluded.lease_until, metadata=excluded.metadata`, ...values, op.plan.id, JSON.stringify(op.plan));
    else sql.exec('UPDATE operations_v2 SET subject=?, repository=?, state=?, expires_at=?, lease_until=?, metadata=? WHERE id=?', ...values, op.plan.id);
  }
  async fetch(request: Request) {
    const data = await request.json() as any;
    if (typeof data.subject !== 'string' || !data.subject) return json({error: 'Subject required'}, 400);
    const response = this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql;
      const revision = sql.exec<{value: number}>("SELECT value FROM state_meta WHERE key='revision'").one().value;
      if (data.action === 'snapshot') {
        let rows = sql.exec<{metadata: string}>('SELECT metadata FROM operations_v2 WHERE subject=?', data.subject).toArray();
        if (data.lock) rows = [...rows, ...sql.exec<{metadata: string}>(`SELECT metadata FROM operations_v2 WHERE subject!=? AND state='running' AND lease_until>?
          UNION SELECT metadata FROM operations_v2 WHERE subject!=? AND repository=? AND state IN ('running','paused')`,
        data.subject, data.lock.now, data.subject, data.lock.repository.toLowerCase()).toArray()];
        return json({revision, entries: rows.map(row => {const op = JSON.parse(row.metadata); return [op.plan.id, op];})});
      }
      if (data.action === 'get') {
        const row = sql.exec<{metadata: string; plan: string}>('SELECT metadata, plan FROM operations_v2 WHERE id=? AND subject=?', data.id, data.subject).toArray()[0];
        return json(row ? {...JSON.parse(row.metadata), plan: JSON.parse(row.plan)} : null);
      }
      if (data.action === 'cas' && data.revision !== revision) return json({conflict: true}, 409);
      for (const op of data.put ?? []) {
        const old = sql.exec<{subject: string}>('SELECT subject FROM operations_v2 WHERE id=?', op.plan.id).toArray()[0];
        if (op.subject !== data.subject || (old && old.subject !== data.subject)) return json({error: 'Subject mismatch'}, 403);
        if (op.plan.files && JSON.stringify(op.plan).length > 100000) return json({error: 'Plan too large'}, 413);
        if (!old && !op.plan.files) return json({error: 'Plan required'}, 400);
      }
      for (const id of data.remove ?? []) sql.exec("DELETE FROM operations_v2 WHERE id=? AND subject=? AND state IN ('preview','complete') AND json_extract(metadata, '$.recoveryError') IS NULL", id, data.subject);
      for (const op of data.put ?? []) this.save(op);
      sql.exec("UPDATE state_meta SET value=value+1 WHERE key='revision'"); return json({ok: true});
    });
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now() + 60000);
    return response;
  }
  async alarm() {
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      // Uncertain writes and their repository locks are never expired here.
      sql.exec("DELETE FROM operations_v2 WHERE state IN ('preview','complete') AND expires_at<=? AND json_extract(metadata, '$.recoveryError') IS NULL", Date.now());
      sql.exec("UPDATE state_meta SET value=value+1 WHERE key='revision'");
    });
    if (sql.exec("SELECT 1 FROM operations_v2 WHERE state IN ('preview','complete') AND json_extract(metadata, '$.recoveryError') IS NULL LIMIT 1").toArray().length) await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
}
export class DurableStore implements StateStore {
  private stub: DurableObjectStub;
  constructor(namespace: DurableObjectNamespace, private subject: string) {this.stub = namespace.get(namespace.idFromName('pkgfactory-v1'));}
  private async call(data: Record<string, unknown>) {
    const result = await this.stub.fetch('https://state.internal/', {method: 'POST', body: JSON.stringify({...data, subject: this.subject})});
    if (!result.ok && result.status !== 409) throw new Error('State unavailable');
    return result.json() as Promise<any>;
  }
  async get(id: string) {return (await this.call({action: 'get', id})) ?? undefined;}
  async put(op: Operation) {await this.call({action: 'put', put: [op]});}
  async transaction<T>(fn: (items: Map<string, Operation>) => T, lock?: {repository: string; now: number}): Promise<T> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const {revision, entries} = await this.call({action: 'snapshot', lock});
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
  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS auth_v2 (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS auth_expiry ON auth_v2(expires_at);`);
      // Retain active pre-upgrade sessions. No per-request full-table list().
      if (!await ctx.storage.get('migrated-v2')) {
        const legacy = await ctx.storage.list<any>();
        ctx.storage.transactionSync(() => {
          for (const [key, item] of legacy) if (item.expiresAt > Date.now()) ctx.storage.sql.exec('INSERT OR IGNORE INTO auth_v2 VALUES (?, ?, ?)', key, JSON.stringify(item.value), item.expiresAt);
        });
        await ctx.storage.put('migrated-v2', true);
        if (legacy.size) await deleteLegacy(ctx.storage, [...legacy.keys()]);
      }
      if (!await ctx.storage.getAlarm()) await ctx.storage.setAlarm(Date.now() + 60000);
    });
  }
  async fetch(request: Request) {
    const data = await request.json() as any;
    const response = this.ctx.storage.transactionSync(() => {
      const sql = this.ctx.storage.sql, now = Date.now();
      const row = sql.exec<{value: string; expires_at: number}>('SELECT value, expires_at FROM auth_v2 WHERE key=? AND expires_at>?', data.key, now).toArray()[0];
      const item = row ? JSON.parse(row.value) : null;
      const put = (value: unknown, until: number) => sql.exec('INSERT INTO auth_v2 VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, expires_at=excluded.expires_at', data.key, JSON.stringify(value), until);
      if (data.action === 'limit') {
        if ((item?.count ?? 0) >= data.value.limit) return json(false);
        put({count: (item?.count ?? 0) + 1}, row?.expires_at ?? now + data.ttl); return json(true);
      }
      if (data.action === 'claim') {
        if (row) return json(false);
        put(true, now + data.ttl); return json(true);
      }
      if (data.action === 'put') {put(data.value, now + data.ttl); return json({ok: true});}
      if (data.action === 'take' || data.action === 'delete') sql.exec('DELETE FROM auth_v2 WHERE key=?', data.key);
      return json(data.action === 'delete' ? null : item);
    });
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now() + 60000);
    return response;
  }
  async alarm() {
    this.ctx.storage.sql.exec('DELETE FROM auth_v2 WHERE expires_at<=?', Date.now());
    if (this.ctx.storage.sql.exec('SELECT 1 FROM auth_v2 LIMIT 1').toArray().length) await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
}
