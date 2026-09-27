import { planPackage, validatePlan, markerPath, type PackagePlan } from '../core/plan.js';
import { base64, decode, sha256, unbase64, utf8 } from '../core/encoding.js';
import { GitHub, GitHubError } from '../github/client.js';
import { generateDeployKey, sealSecret, type KeyAlgorithm } from '../github/keys.js';
import type { Operation, StateStore } from './state.js';
export class FactoryError extends Error {
  constructor(public code: string, message: string, public status = 409) {super(message);}
}
export interface Credentials {token: string; subject: string}
export interface EngineOptions {fetcher?: typeof fetch; algorithm?: KeyAlgorithm; now?: () => number; keyGenerator?: typeof generateDeployKey; local?: boolean; beforeRequest?: () => Promise<void>}
export class Factory {
  private now: () => number;
  constructor(private store: StateStore, private options: EngineOptions = {}) {this.now = options.now ?? Date.now;}
  async preview(input: unknown, subject: string): Promise<PackagePlan> {
    const plan = await planPackage(input);
    await this.store.transaction(items => {
      for (const [id, op] of items) if ((op.state === 'preview' || op.state === 'complete') && op.expiresAt < this.now()) items.delete(id);
      if (items.size >= 256 || [...items.values()].filter(o => o.subject === subject).length >= 16) throw new FactoryError('capacity', 'Too many saved plans', 429);
      items.set(plan.id, {plan, subject, expiresAt: this.now() + 15 * 60000, state: 'preview'});
    });
    return plan;
  }
  async importPlan(plan: PackagePlan, subject: string) {
    await validatePlan(plan);
    await this.store.transaction(items => {
      const old = items.get(plan.id);
      if (old && (old.subject !== subject || old.plan.digest !== plan.digest)) throw new FactoryError('plan', 'Plan ownership mismatch', 403);
      if (!old) items.set(plan.id, {plan, subject, expiresAt: this.now() + 15 * 60000, state: 'preview'});
    });
  }
  private async owned(id: string, subject: string) {
    const op = await this.store.get(id);
    if (!op || op.subject !== subject) throw new FactoryError('plan', 'Plan not found', 404);
    return op;
  }
  private client(c: Credentials, signal: AbortSignal) {return new GitHub(c.token, signal, this.options.fetcher, this.options.beforeRequest);}
  private async inspect(op: Operation, github: GitHub) {
    const root = `/repos/${op.plan.repository}`;
    const repository = await github.request('GET', root, undefined, true);
    if (!repository) return {repository: null, marker: null, head: null, keys: [], secret: null, pages: null};
    const head = await github.request('GET', `${root}/git/ref/heads/${encodeURIComponent(repository.default_branch)}`, undefined, true);
    let marker = null;
    if (head) {
      const raw = await github.request('GET', `${root}/contents/${markerPath}?ref=${head.object.sha}`, undefined, true);
      if (raw) {try {marker = JSON.parse(decode(unbase64(raw.content.replace(/\s/g, ''))));} catch {throw new FactoryError('marker', 'Invalid recovery marker');}}
    }
    const docs = op.plan.spec.template !== 'minimum';
    const keys = docs ? await github.pages<any>(`${root}/keys`) : [];
    const secret = docs ? await github.request('GET', `${root}/actions/secrets/DOCUMENTER_KEY`, undefined, true) : null;
    const pages = docs ? await github.request('GET', `${root}/pages`, undefined, true) : null;
    return {repository, marker, head, keys, secret, pages};
  }
  async status(id: string, c: Credentials, signal = new AbortController().signal) {
    const op = await this.owned(id, c.subject);
    const remote = await this.inspect(op, this.client(c, signal));
    return {planId: id, repository: op.plan.repository, state: op.state, pending: op.pending?.stage,
      error: op.error, leaseUntil: op.leaseUntil, exists: !!remote.repository,
      markerMatches: remote.marker?.digest === op.plan.digest, remoteState: remote.marker?.state,
      head: remote.head?.object.sha, deployKeys: remote.keys.map((k: any) => ({id: k.id, title: k.title})),
      documenterSecret: !!remote.secret, pagesUrl: remote.pages?.html_url,
      canResumeAfter: op.leaseUntil ? new Date(op.leaseUntil).toISOString() : undefined};
  }
  async execute(id: string, c: Credentials, resume = false, externalSignal = new AbortController().signal) {
    const signal = AbortSignal.any([externalSignal, AbortSignal.timeout(120000)]);
    const github = this.client(c, signal);
    const op = await this.owned(id, c.subject);
    if (op.state === 'complete') return this.result(op);
    // Confirm that the credential really belongs to the bound GitHub identity.
    const viewer = await github.request('GET', '/user');
    if (!this.options.local && String(viewer.id) !== c.subject) throw new FactoryError('identity', 'GitHub identity changed', 403);
    await this.store.transaction(items => {
      const current = items.get(id)!;
      if (current.leaseUntil && current.leaseUntil > this.now()) throw new FactoryError('busy', 'Wait for the recorded lease deadline, then inspect and resume');
      if (current.state !== 'preview' && !resume) throw new FactoryError('resume', 'Inspect status, then explicitly resume');
      if (current.state === 'preview' && current.expiresAt < this.now()) throw new FactoryError('expired', 'Preview expired. Generate a new preview.');
      const sameRepo = (o: Operation) => o.plan.repository.toLowerCase() === op.plan.repository.toLowerCase();
      if ([...items.values()].some(o => o.plan.id !== id && sameRepo(o) && (o.state === 'running' || o.state === 'paused'))) throw new FactoryError('locked', 'Another plan holds this repository lock. Resume that plan.');
      if ([...items.values()].filter(o => o.state === 'running' && (o.leaseUntil ?? 0) > this.now()).length >= 8) throw new FactoryError('capacity', 'Too many concurrent operations', 429);
      const {plan: _plan, ...metadata} = current;
      Object.assign(op, metadata);
      current.state = 'running'; current.leaseUntil = this.now() + 150000;
      op.state = current.state; op.leaseUntil = current.leaseUntil;
    });
    const root = `/repos/${op.plan.repository}`;
    const persist = () => this.store.put(op);
    const write = async (stage: string, method: string, path: string, body?: unknown) => {
      signal.throwIfAborted();
      op.pending = {stage, method, path, startedAt: this.now()}; await persist();
      signal.throwIfAborted();
      const value = await github.request(method, path, body);
      // The pending entry is cleared only with the caller's persisted checkpoint.
      return value;
    };
    const checkpoint = async () => {delete op.pending; await persist();};
    try {
      let remote = await this.inspect(op, github);
      if (resume) {
        // A stale lease is never simply deleted. First reconcile observable GitHub state.
        op.reconciliation = {at: this.now(), repositoryId: remote.repository?.id, head: remote.head?.object.sha, pending: op.pending?.stage};
        await persist();
      }
      if (op.repositoryId && !remote.repository) throw new FactoryError('missing', 'Saved repository is no longer visible. Inspect access and deletion before continuing.');
      if (remote.repository) {
        if (!resume) throw new FactoryError('exists', 'Repository already exists. Use explicit resume only for this saved plan.');
        if (op.repositoryId && op.repositoryId !== remote.repository.id) throw new FactoryError('ownership', 'Repository was replaced. Automatic resume refused.');
        const ours = remote.marker?.planId === id && remote.marker?.digest === op.plan.digest;
        const bootstrap = remote.repository.description === this.bootstrapDescription(op) && (!op.repositoryId || op.repositoryId === remote.repository.id);
        if (!ours && !bootstrap) throw new FactoryError('ownership', 'Repository cannot be proven to belong to this plan. Manual inspection required.');
        if (remote.marker && !ours) throw new FactoryError('marker', 'Recovery marker does not match');
        if (ours) {
          const project = await github.request('GET', `${root}/contents/Project.toml?ref=${remote.head.object.sha}`);
          if (await sha256(decode(unbase64(project.content.replace(/\s/g, '')))) !== remote.marker.projectSha256) throw new FactoryError('changed', 'Project.toml changed. Automatic resume refused.');
          op.commit = remote.head.object.sha;
        }
      } else {
        const endpoint = viewer.login.toLowerCase() === op.plan.spec.owner.toLowerCase() ? '/user/repos' : `/orgs/${op.plan.spec.owner}/repos`;
        const repo = await write('repository', 'POST', endpoint, {name: `${op.plan.spec.name}.jl`, description: this.bootstrapDescription(op), private: op.plan.spec.visibility === 'private', auto_init: true});
        op.repositoryId = repo.id; await checkpoint();
        remote = await this.inspect(op, github);
      }
      if (!remote.repository) throw new FactoryError('repository', 'Created repository is not visible yet. Inspect and resume.');
      op.repositoryId = remote.repository.id;
      if (!remote.marker) {
        const head = remote.head;
        if (!head) throw new FactoryError('initializing', 'Initial branch is not ready. Inspect and resume.');
        // Never overwrite another commit made since our first observation.
        if (op.base && op.base !== head.object.sha && op.commit !== head.object.sha) throw new FactoryError('changed', 'Branch changed during setup');
        op.base ??= head.object.sha; await checkpoint();
        if (!op.tree) {
          const tree = await write('tree', 'POST', `${root}/git/trees`, {tree: Object.entries(op.plan.files).map(([path, content]) => ({path, mode: '100644', type: 'blob', content}))});
          op.tree = tree.sha; await checkpoint();
        }
        if (!op.commit) {
          const commit = await write('commit', 'POST', `${root}/git/commits`, {message: 'Create Julia package with PkgFactory', tree: op.tree, parents: [op.base]});
          op.commit = commit.sha; await checkpoint();
        }
        await write('files', 'PATCH', `${root}/git/refs/heads/${encodeURIComponent(remote.repository.default_branch)}`, {sha: op.commit, force: false}); await checkpoint();
      }
      const main = await github.request('GET', `${root}/git/ref/heads/main`, undefined, true);
      if (!main) {await write('main', 'POST', `${root}/git/refs`, {ref: 'refs/heads/main', sha: op.commit}); await checkpoint();}
      else if (main.object.sha !== op.commit) throw new FactoryError('changed', 'main branch changed. Automatic overwrite refused.');
      if (remote.repository.default_branch !== 'main' || remote.repository.description !== op.plan.spec.description) {
        await write('settings', 'PATCH', root, {default_branch: 'main', description: op.plan.spec.description}); await checkpoint();
      }
      if (op.plan.spec.template !== 'minimum') {
        if (!await github.request('GET', `${root}/git/ref/heads/gh-pages`, undefined, true)) {
          await write('gh-pages', 'POST', `${root}/git/refs`, {ref: 'refs/heads/gh-pages', sha: op.commit}); await checkpoint();
        }
        if (!op.keyReady || !remote.secret || !remote.keys.some((k: any) => k.title === op.keyTitle && !k.read_only)) {
          // Secrets cannot be read back. Explicit resume replaces an uncertain key/secret
          // pair with a fresh pair; it never silently retries the lost secret write.
          signal.throwIfAborted();
          const key = await (this.options.keyGenerator ?? generateDeployKey)(this.options.algorithm ?? 'ed25519');
          op.keyTitle = `PkgFactory:${id}:${crypto.randomUUID()}`; op.keyReady = false; await persist();
          await write('deploy-key', 'POST', `${root}/keys`, {title: op.keyTitle, key: key.publicKey, read_only: false}); await checkpoint();
          const repoKey = await github.request('GET', `${root}/actions/secrets/public-key`);
          await write('documenter-secret', 'PUT', `${root}/actions/secrets/DOCUMENTER_KEY`, {key_id: repoKey.key_id, encrypted_value: sealSecret(key.secret, unbase64(repoKey.key))});
          op.keyReady = true; await checkpoint();
        }
        // Delete only keys from this exact plan, and only after a confirmed secret write.
        for (const key of await github.pages<any>(`${root}/keys`)) if (key.title.startsWith(`PkgFactory:${id}:`) && key.title !== op.keyTitle) {
          await write('old-key', 'DELETE', `${root}/keys/${key.id}`); await checkpoint();
        }
        const pages = await github.request('GET', `${root}/pages`, undefined, true);
        if (!pages) {await write('pages', 'POST', `${root}/pages`, {source: {branch: 'gh-pages', path: '/'}}); await checkpoint();}
        else if (pages.source?.branch !== 'gh-pages' || pages.source?.path !== '/') throw new FactoryError('pages', 'Existing Pages configuration differs; inspect it manually');
      }
      const marker = await github.request('GET', `${root}/contents/${markerPath}?ref=main`);
      const value = JSON.parse(decode(unbase64(marker.content.replace(/\s/g, ''))));
      if (value.planId !== id || value.digest !== op.plan.digest) throw new FactoryError('marker', 'Recovery marker changed');
      if (value.state !== 'complete') {
        await write('complete', 'PUT', `${root}/contents/${markerPath}`, {message: 'Complete PkgFactory setup', branch: 'main', sha: marker.sha, content: base64(utf8(JSON.stringify({...value, state: 'complete'}, null, 2) + '\n'))});
      }
      op.state = 'complete'; delete op.leaseUntil; op.expiresAt = this.now() + 15 * 60000; delete op.error; await checkpoint();
      return this.result(op);
    } catch (error) {
      op.state = 'paused'; op.error = error instanceof FactoryError || error instanceof GitHubError ? error.message : 'Setup stopped. Inspect status, then explicitly resume.';
      // Keep the lease until every dispatched GitHub request has had time to settle.
      await persist(); throw error;
    }
  }
  private bootstrapDescription(op: Operation) {return `PkgFactory setup ${op.plan.id}`;}
  private result(op: Operation) {return {planId: op.plan.id, repository: op.plan.repository, url: `https://github.com/${op.plan.repository}`, state: 'complete' as const};}
}
