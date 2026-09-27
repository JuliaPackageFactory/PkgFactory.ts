import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Operation, StateStore } from '../application/state.js';
/** Cross-process atomic metadata journal. No credentials or private keys are stored. */
export class FileStore implements StateStore {
  constructor(private directory: string) {}
  async transaction<T>(fn: (items: Map<string, Operation>) => T): Promise<T> {
    await mkdir(this.directory, {recursive: true, mode: 0o700});
    const lock = join(this.directory, 'journal.lock');
    let acquired = false;
    for (let i = 0; i < 100; i++) {
      try {await writeFile(lock, String(process.pid), {flag: 'wx', mode: 0o600}); acquired = true; break;}
      catch (e: any) {if (e.code !== 'EEXIST') throw e; await new Promise(r => setTimeout(r, 20));}
    }
    if (!acquired) throw new Error('State journal is busy. If its recorded process has exited, remove journal.lock; repository leases will still require GitHub reconciliation.');
    try {
      let data: [string, Operation][] = [];
      try {data = JSON.parse(await readFile(join(this.directory, 'journal.json'), 'utf8'));} catch (e: any) {if (e.code !== 'ENOENT') throw e;}
      const items = new Map(data); const value = fn(items);
      const temporary = join(this.directory, `journal-${process.pid}.tmp`);
      await writeFile(temporary, JSON.stringify([...items]), {mode: 0o600});
      await rename(temporary, join(this.directory, 'journal.json'));
      return structuredClone(value);
    } finally {await unlink(lock);}
  }
  get(id: string) {return this.transaction(items => items.get(id));}
  async put(op: Operation) {await this.transaction(items => {items.set(op.plan.id, structuredClone(op));});}
}
