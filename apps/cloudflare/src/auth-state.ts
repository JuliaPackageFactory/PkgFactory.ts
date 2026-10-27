import { DurableObject } from 'cloudflare:workers';
import { json } from '../../../packages/pkgfactory/src/web/http.js';
/** Short-lived records without personal data: login-rate counters per source
 * hash, consumed OAuth state hashes, and hashes of signed-out session IDs. */
export class AuthState extends DurableObject {
  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS auth_v2 (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS auth_expiry ON auth_v2(expires_at);`);
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
      if (data.action === 'get') return json(item);
      return json({error: 'Unknown action'}, 400);
    });
    if (!await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(Date.now() + 60000);
    return response;
  }
  async alarm() {
    this.ctx.storage.sql.exec('DELETE FROM auth_v2 WHERE expires_at<=?', Date.now());
    if (this.ctx.storage.sql.exec('SELECT 1 FROM auth_v2 LIMIT 1').toArray().length) await this.ctx.storage.setAlarm(Date.now() + 60000);
  }
}
