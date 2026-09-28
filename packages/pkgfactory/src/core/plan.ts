import Mustache from 'mustache';
import sources from './templates.json' with {type: 'json'};
import { specSchema, type PackageSpec } from './spec.js';
import { sha256 } from './encoding.js';
import { markdownText } from './markdown.js';
export interface PackagePlan {
  version: 1; id: string; createdAt: string; spec: PackageSpec; uuid: string;
  repository: string; files: Record<string, string>; digest: string;
}
export const markerPath = '.pkgfactory.json';
export async function planPackage(input: unknown, fixed?: {id: string; uuid: string; date: string}): Promise<PackagePlan> {
  const spec = specSchema.parse(input);
  const id = fixed?.id ?? crypto.randomUUID();
  const uuid = fixed?.uuid ?? crypto.randomUUID();
  const createdAt = fixed?.date ?? new Date().toISOString();
  const repo = `${spec.name}.jl`;
  const context = {PKG: spec.name, REPO: repo, OWNER: spec.owner, DESCR: markdownText(spec.description),
    UUID: uuid, AUTHORS: JSON.stringify(spec.authors), CFF_AUTHORS: spec.authors.map(a => `  - family-names: ${JSON.stringify(a)}`).join('\n'),
    LICENSOR: spec.authors.join(', '), URL: `https://github.com/${spec.owner}/${repo}`, VERSION: '0.0.1', YEAR: createdAt.slice(0, 4), RELEASE_DATE: createdAt.slice(0, 10)};
  const files: Record<string, string> = {};
  for (const [key, source] of Object.entries(sources).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    if (!key.startsWith(spec.template + '/')) continue;
    const path = key.slice(spec.template.length + 1).replace('src/PKG.jl', `src/${spec.name}.jl`).replace('examples/PKG.ipynb', `examples/${spec.name}.ipynb`);
    // Julia string interpolation also requires escaping dollar signs.
    const ctx = path.endsWith('.jl') ? {...context, LICENSOR: JSON.stringify(context.LICENSOR).slice(1, -1).replaceAll('$', '\\$')} : context;
    files[path] = path.endsWith('.yml') && !path.endsWith('/CI.yml') ? source : Mustache.render(source, ctx);
  }
  const repository = `${spec.owner}/${repo}`;
  const digest = await sha256(JSON.stringify({spec, uuid, files}));
  files[markerPath] = JSON.stringify({version: 1, planId: id, digest, uuid, state: 'files_committed', projectSha256: await sha256(files['Project.toml'])}, null, 2) + '\n';
  return {version: 1, id, createdAt, spec, uuid, repository, files, digest};
}
export async function validatePlan(plan: PackagePlan): Promise<void> {
  const expected = await planPackage(plan.spec, {id: plan.id, uuid: plan.uuid, date: plan.createdAt});
  if (JSON.stringify(expected) !== JSON.stringify(plan)) throw new Error('Plan is invalid or was modified. Create a new preview.');
}
