import { base64, utf8, unbase64, decode } from '../packages/pkgfactory/src/core/encoding.js';
import { cryptoBoxKeyPair } from '@serenity-kit/noble-sodium';
export class FakeGitHub {
  calls: {method: string; path: string; body: any}[] = [];
  repository: any = null;
  refs: Record<string, string> = {};
  files: Record<string, string> = {};
  trees: Record<string, Record<string, string>> = {};
  commits: Record<string, string> = {};
  keys: any[] = []; secret: any = null; pages: any = null;
  before?: (method: string, path: string) => void;
  after?: (method: string, path: string) => void;
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); const path = url.pathname; const method = init?.method ?? 'GET';
    this.before?.(method, path);
    if (init?.signal?.aborted) throw new Error('Aborted');
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    this.calls.push({method, path, body});
    const respond = (value: unknown, status = 200) => {this.after?.(method, path); return new Response(status === 204 ? null : JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});};
    if (path === '/user') return respond({id: 42, login: 'tester', name: 'Test Author'});
    if (path === '/user/memberships/orgs') return respond([]);
    if (path === '/user/repos' || /\/orgs\/.*\/repos/.test(path)) {
      this.repository = {id: 10, default_branch: 'main', description: body.description, topics: []};
      if (body.auto_init) this.refs.main = 'initial'; return respond(this.repository, 201);
    }
    const suffix = path.replace(/^\/repos\/[^/]+\/[^/]+/, '');
    if (!this.repository) return respond({}, 404);
    if (suffix === '/branches') return respond(Object.keys(this.refs).map(name => ({name})));
    if (!suffix) {if (method === 'PATCH') Object.assign(this.repository, body); return respond(this.repository);}
    if (suffix === '/topics') {if (method === 'PUT') this.repository.topics = body.names; return respond({names: this.repository.topics});}
    if (suffix.startsWith('/git/ref/heads/')) {const branch = decodeURIComponent(suffix.slice(15)); return this.refs[branch] ? respond({object: {sha: this.refs[branch]}}) : respond({}, Object.keys(this.refs).length ? 404 : 409);}
    if (suffix.startsWith('/contents/')) {
      const file = suffix.slice(10);
      if (method === 'PUT') {this.files[file] = decode(unbase64(body.content)); this.refs.main = file === 'README.md' ? 'initial' : 'completed'; return respond({content: {sha: 'file'}, commit: {sha: this.refs.main}});}
      return this.files[file] ? respond({content: base64(utf8(this.files[file])), sha: 'file-sha'}) : respond({}, 404);
    }
    if (suffix === '/git/trees') {const sha = `tree${this.calls.length}`; this.trees[sha] = Object.fromEntries(body.tree.map((f: any) => [f.path, f.content])); return respond({sha}, 201);}
    if (suffix === '/git/commits') {const sha = `commit${this.calls.length}`; this.commits[sha] = body.tree; return respond({sha}, 201);}
    if (suffix === '/git/refs' || suffix.startsWith('/git/refs/heads/')) {
      const branch = body.ref?.replace('refs/heads/', '') ?? suffix.slice(16);
      this.refs[branch] = body.sha;
      if (branch === 'main') this.files = structuredClone(this.trees[this.commits[body.sha]] ?? this.files);
      return respond({ref: `refs/heads/${branch}`, object: {sha: body.sha}});
    }
    if (suffix === '/keys') {if (method === 'POST') {const key = {id: this.keys.length + 1, ...body}; this.keys.push(key); return respond(key, 201);} return respond(this.keys);}
    if (suffix.startsWith('/keys/')) {this.keys = this.keys.filter(k => k.id !== Number(suffix.split('/').pop())); return respond(null, 204);}
    if (suffix === '/actions/secrets/public-key') return respond({key_id: '1', key: base64(cryptoBoxKeyPair().publicKey)});
    if (suffix === '/actions/secrets/DOCUMENTER_KEY') {if (method === 'PUT') {this.secret = {name: 'DOCUMENTER_KEY'}; return respond(null, 204);} return this.secret ? respond(this.secret) : respond({}, 404);}
    if (suffix === '/pages') {if (method === 'POST') this.pages = {...body, html_url: 'https://tester.github.io/Test.jl/'}; return this.pages ? respond(this.pages) : respond({}, 404);}
    throw new Error(`Unimplemented fake endpoint ${method} ${suffix}`);
  };
}
