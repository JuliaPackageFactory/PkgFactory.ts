import type { PackagePlan } from '../core/plan.js';
export interface PendingWrite {stage: string; method: string; path: string; startedAt: number}
export interface Operation {
  plan: PackagePlan; subject: string; expiresAt: number;
  state: 'preview' | 'running' | 'paused' | 'complete';
  leaseUntil?: number; pending?: PendingWrite; error?: string;
  repositoryId?: number; commit?: string; tree?: string; base?: string;
  keyTitle?: string; keyReady?: boolean;
  recoveryError?: 'missing_plan';
  reconciliation?: {at: number; repositoryId?: number; head?: string; pending?: string};
}
export interface StateStore {
  get(id: string): Promise<Operation | undefined>;
  put(operation: Operation): Promise<void>;
  /** Atomic local mutation. Never perform network I/O inside this callback. */
  transaction<T>(fn: (items: Map<string, Operation>) => T, lock?: {repository: string; now: number}): Promise<T>;
}
export class MemoryStore implements StateStore {
  protected items = new Map<string, Operation>();
  private tail: Promise<unknown> = Promise.resolve();
  async transaction<T>(fn: (items: Map<string, Operation>) => T): Promise<T> {
    const task = this.tail.then(() => fn(this.items)); this.tail = task.catch(() => {}); return task;
  }
  async get(id: string) {return this.transaction(items => structuredClone(items.get(id)));}
  async put(operation: Operation) {await this.transaction(items => {items.set(operation.plan.id, structuredClone(operation));});}
}
