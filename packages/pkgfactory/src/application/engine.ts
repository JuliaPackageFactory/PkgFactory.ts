import { planPackage, markerPath, type PackagePlan } from '../core/plan.js';
import { specSchema } from '../core/spec.js';
import { base64, unbase64, utf8 } from '../core/encoding.js';
import { GitHub, GitHubError } from '../github/client.js';
import { organizationInstallations, unknownInstallations } from '../github/apps.js';
import { generateDeployKey, sealSecret, type KeyAlgorithm } from '../github/keys.js';
export class FactoryError extends Error {
  constructor(public code: string, message: string, public status = 409) {super(message);}
}
export interface Credentials {token: string; subject: string}
export interface EngineOptions {fetcher?: typeof fetch; algorithm?: KeyAlgorithm; keyGenerator?: typeof generateDeployKey; local?: boolean; beforeRequest?: () => Promise<void>}
export interface CreationResult {planId: string; repository: string; url: string; state: 'complete'; pagesUrl?: string}
const generatedCommit = 'Using PkgFactory\n\nhttps://github.com/JuliaPackageFactory/PkgFactory.ts';
/** Stateless engine. A plan is a pure function of its inputs, so nothing is stored
 * between a preview and the creation that uses it, and no journal is kept. */
export class Factory {
  constructor(private options: EngineOptions = {}) {}
  preview(input: unknown): Promise<PackagePlan> {return planPackage(input);}
  async previewForAccount(input: unknown, c: Credentials, signal = new AbortController().signal) {
    const spec = specSchema.parse(input);
    const check = await this.repositoryAvailability({owner: spec.owner, name: spec.name}, c, signal);
    if (!check.available) throw new FactoryError('exists', `${check.repository} already exists. Choose a different package name.`);
    signal.throwIfAborted();
    return planPackage(spec);
  }
  private client(c: Credentials, signal: AbortSignal) {return new GitHub(c.token, signal, this.options.fetcher, this.options.beforeRequest);}
  private async viewer(github: GitHub, c: Credentials) {
    const viewer = await github.request('GET', '/user');
    if (!this.options.local && String(viewer.id) !== c.subject) throw new FactoryError('identity', 'GitHub identity changed. Sign in again.', 403);
    return viewer;
  }
  private async requireOwner(github: GitHub, login: string, owner: string) {
    if (login.toLowerCase() === owner.toLowerCase()) return;
    const membership = await github.request('GET', `/user/memberships/orgs/${encodeURIComponent(owner)}`, undefined, true);
    if (membership?.state !== 'active' || membership?.role !== 'admin') {
      throw new FactoryError('owner', 'Choose your own account or an organization where you are an owner and have granted PkgFactory access.', 403);
    }
  }
  async githubProfile(c: Credentials, signal = new AbortController().signal) {
    const github = this.client(c, signal);
    try {
      const viewer = await this.viewer(github, c);
      const memberships = await github.pages<any>('/user/memberships/orgs?state=active');
      const user = {login: viewer.login as string, name: (viewer.name?.trim() || viewer.login) as string, kind: 'user' as const};
      const organizations = memberships.filter(m => m.state === 'active' && m.role === 'admin')
        .map(m => ({login: m.organization.login as string, name: (m.organization.name || m.organization.login) as string, kind: 'organization' as const}))
        .sort((a, b) => a.login.toLowerCase().localeCompare(b.login.toLowerCase()));
      return {user, owners: [user, ...organizations]};
    } catch (error) {throw this.accountError(error);}
  }
  async repositoryAvailability(input: unknown, c: Credentials, signal = new AbortController().signal) {
    const parsed = specSchema.pick({owner: true, name: true}).safeParse(input);
    if (!parsed.success) throw new FactoryError('name', parsed.error.issues[0].message, 400);
    const {owner, name} = parsed.data;
    const github = this.client(c, signal);
    try {
      const viewer = await this.viewer(github, c);
      await this.requireOwner(github, viewer.login, owner);
      const repository = `${owner}/${name}.jl`;
      const existing = await github.request('GET', `/repos/${repository}`, undefined, true);
      return {repository, available: !existing};
    } catch (error) {throw this.accountError(error);}
  }
  async githubApps(input: unknown, c: Credentials, signal = new AbortController().signal) {
    const {owner} = specSchema.pick({owner: true}).parse(input);
    const github = this.client(c, signal);
    const viewer = await this.viewer(github, c);
    await this.requireOwner(github, viewer.login, owner);
    if (viewer.login.toLowerCase() === owner.toLowerCase()) return unknownInstallations();
    try {return await organizationInstallations(github, owner);}
    catch (error) {
      signal.throwIfAborted();
      // Installation reads are optional; never interpret missing scope, rate
      // limits, or a failed lookup as evidence that an app is not installed.
      if (error instanceof GitHubError && error.status !== 401) return unknownInstallations();
      throw this.accountError(error);
    }
  }
  private accountError(error: unknown) {
    if (!(error instanceof GitHubError)) return error;
    if (error.status === 401) return new FactoryError('auth', 'GitHub authorization expired or was revoked. Connect GitHub again.', 401);
    if (error.status === 403) return new FactoryError('github_access', 'GitHub access could not be verified. Check token permissions, organization access, or the GitHub rate limit, then retry.', 403);
    return new FactoryError('github_lookup', 'Could not check GitHub. Retry before continuing.', 502);
  }
  /** Create and configure the repository described by a plan. GitHub writes run
   * once, in order, without a journal. A failure names the step that stopped and
   * leaves the repository on GitHub for manual inspection or deletion. */
  async execute(plan: PackagePlan, c: Credentials, externalSignal = new AbortController().signal): Promise<CreationResult> {
    const signal = AbortSignal.any([externalSignal, AbortSignal.timeout(120000)]);
    const github = this.client(c, signal);
    const root = `/repos/${plan.repository}`;
    let viewer: any;
    try {
      // Confirm that the credential really belongs to the bound GitHub identity.
      viewer = await this.viewer(github, c);
      await this.requireOwner(github, viewer.login, plan.spec.owner);
      if (await github.request('GET', root, undefined, true)) throw new FactoryError('exists', `${plan.repository} already exists. Choose a different package name. If an earlier setup left it incomplete, delete it on GitHub before creating the package again.`);
    } catch (error) {throw this.accountError(error);}
    let stage = 'repository';
    const write = <T = any>(name: string, method: string, path: string, body?: unknown): Promise<T> => {stage = name; return github.request<T>(method, path, body);};
    let pagesUrl: string | undefined;
    try {
      const personal = viewer.login.toLowerCase() === plan.spec.owner.toLowerCase();
      const repo = await write('repository', 'POST', personal ? '/user/repos' : `/orgs/${plan.spec.owner}/repos`, {name: `${plan.spec.name}.jl`, description: plan.spec.description, private: plan.spec.visibility === 'private', auto_init: false});
      // The Contents API initializes the empty repository with our own commit
      // message. No workflows exist yet, so this does not start CI.
      const initial = await write('initialize', 'PUT', `${root}/contents/README.md`, {message: generatedCommit, branch: 'main', content: base64(utf8(plan.files['README.md']))});
      const tree = await write('tree', 'POST', `${root}/git/trees`, {tree: Object.entries(plan.files).map(([path, content]) => ({path, mode: '100644', type: 'blob', content}))});
      // Run push CI only after the completion commit, when keys and secrets
      // are configured. Do not change the generated workflow triggers.
      const commit = await write('commit', 'POST', `${root}/git/commits`, {message: `${generatedCommit}\n\nPrepare package files before configuring automation.\n\n[skip ci]`, tree: tree.sha, parents: [initial.commit.sha]});
      await write('files', 'PATCH', `${root}/git/refs/heads/main`, {sha: commit.sha, force: false});
      if (repo.default_branch !== 'main') await write('settings', 'PATCH', root, {default_branch: 'main'});
      await write('topics', 'PUT', `${root}/topics`, {names: ['julia', 'juliapackagefactory']});
      if (plan.spec.template !== 'minimum') {
        await write('gh-pages', 'POST', `${root}/git/refs`, {ref: 'refs/heads/gh-pages', sha: commit.sha});
        // The private key exists only in memory until it is sealed for GitHub.
        const key = await (this.options.keyGenerator ?? generateDeployKey)(this.options.algorithm ?? 'ed25519');
        await write('deploy-key', 'POST', `${root}/keys`, {title: `PkgFactory:${plan.id}`, key: key.publicKey, read_only: false});
        const repoKey = await write('documenter-secret', 'GET', `${root}/actions/secrets/public-key`);
        await write('documenter-secret', 'PUT', `${root}/actions/secrets/DOCUMENTER_KEY`, {key_id: repoKey.key_id, encrypted_value: sealSecret(key.secret, unbase64(repoKey.key))});
        const pages = await write('pages', 'POST', `${root}/pages`, {source: {branch: 'gh-pages', path: '/'}});
        if (typeof pages?.html_url === 'string') pagesUrl = pages.html_url;
      }
      // The completion commit marks the repository as fully configured and starts push CI once.
      const marker = await write('complete', 'GET', `${root}/contents/${markerPath}?ref=main`);
      const value = {...JSON.parse(plan.files[markerPath]), state: 'complete'};
      await write('complete', 'PUT', `${root}/contents/${markerPath}`, {message: 'Complete PkgFactory setup\n\nGenerated using https://github.com/JuliaPackageFactory/PkgFactory.ts', branch: 'main', sha: marker.sha, content: base64(utf8(JSON.stringify(value, null, 2) + '\n'))});
      return {planId: plan.id, repository: plan.repository, url: `https://github.com/${plan.repository}`, state: 'complete', pagesUrl};
    } catch (error) {
      const reason = error instanceof GitHubError ? error.message : signal.aborted ? 'The connection closed or the deadline passed before setup finished.' : 'Setup stopped unexpectedly.';
      throw new FactoryError('incomplete', `Setup of ${plan.repository} stopped at the "${stage}" step. ${reason} The repository may exist on GitHub in an incomplete state: inspect https://github.com/${plan.repository}, then delete it before creating the package again.`, error instanceof GitHubError && error.status === 401 ? 401 : 409);
    }
  }
}
