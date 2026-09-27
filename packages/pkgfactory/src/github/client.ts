export class GitHubError extends Error {
  constructor(public status: number, public uncertain: boolean, public requestId?: string, public fields?: string) {
    super(`GitHub request failed (${status || 'network'}).${fields ? ` Fields: ${fields}.` : ''}${uncertain ? ' Outcome unknown; inspect status before explicit resume.' : ''}`);
  }
}
export class GitHub {
  constructor(private token: string, private signal: AbortSignal, private fetcher: typeof fetch = fetch, private beforeRequest?: () => Promise<void>) {}
  async request<T = any>(method: string, path: string, body?: unknown, missing = false): Promise<T> {
    this.signal.throwIfAborted();
    await this.beforeRequest?.();
    this.signal.throwIfAborted();
    let response: Response;
    try {
      response = await this.fetcher(`https://api.github.com${path}`, {
        method, headers: {Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json',
          'User-Agent': 'PkgFactory', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? {'Content-Type': 'application/json'} : {})},
        body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error',
        signal: AbortSignal.any([this.signal, AbortSignal.timeout(30000)]),
      });
    } catch { throw new GitHubError(0, method !== 'GET'); }
    if (missing && response.status === 404) return null as T;
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as any;
      const disabled = error.errors?.some?.((e: any) => e.message === 'Deploy keys are disabled for this repository');
      const fields = disabled ? 'deploy_keys_disabled_by_organization' : Array.isArray(error.errors) ? error.errors.map((e: any) => [e.field, e.code].filter((s: unknown) => typeof s === 'string' && /^[a-z_]+$/.test(s)).join(':')).join(',') : undefined;
      throw new GitHubError(response.status, method !== 'GET' && response.status >= 500, response.headers.get('x-github-request-id') ?? undefined, fields);
    }
    if (response.status === 204) return undefined as T;
    try { return await response.json() as T; }
    catch { throw new GitHubError(response.status, method !== 'GET'); }
  }
  async pages<T>(path: string): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; page <= 100; page++) {
      const items = await this.request<T[]>('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      all.push(...items); if (items.length < 100) return all;
    }
    throw new Error('GitHub pagination exceeded safety limit');
  }
}
