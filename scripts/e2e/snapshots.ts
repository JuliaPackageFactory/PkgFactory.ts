import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import TOML from '@iarna/toml';
import { markerPath, planPackage } from '../../packages/pkgfactory/src/core/plan.js';
import { markdownText, documenterText } from '../../packages/pkgfactory/src/core/markdown.js';
import { sourceRepository, type Target } from './config.js';

export function git(directory: string, ...args: string[]): string {
  return execFileSync('git', ['-c', `safe.directory=${resolve(directory).replaceAll('\\', '/')}`, '-C', directory, ...args], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trimEnd();
}
export function head(directory: string): string | null {
  const result = spawnSync('git', ['-C', directory, 'rev-parse', '--verify', '--quiet', 'HEAD'], {encoding: 'utf8'});
  if (result.status === 1) return null;
  if (result.status !== 0) throw new Error('Cannot read snapshot HEAD');
  return result.stdout.trim();
}
export async function snapshot(directory: string, target: Target) {
  const previous = head(directory);
  const project = previous ? TOML.parse(await readFile(join(directory, 'Project.toml'), 'utf8')) : null;
  const acceptedNames: readonly string[] = [target.name, ...target.previousNames];
  if (project && !acceptedNames.includes(project.name as string)) throw new Error(`Unexpected package name in ${target.name}.jl`);
  const uuid = project ? project.uuid : crypto.randomUUID();
  if (typeof uuid !== 'string' || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(uuid)) throw new Error('Invalid existing package UUID');
  // Use the repository's first commit date so repeated runs do not churn the
  // license year and citation date. The UUID is also retained across renames.
  const date = previous ? git(directory, 'log', '--reverse', '--format=%cI').split('\n')[0] : new Date().toISOString();
  const description = `Integration tests for the ${target.template} template of [PkgFactory](https://github.com/${sourceRepository}).`;
  const plan = await planPackage({owner: 'JuliaPackageFactory', name: target.name, template: target.template, authors: ['Shuhei Ohno'],
    description},
  {id: 'persistent-template-test', uuid, date});
  // This description is maintained here, not supplied by a user. Preserve its
  // Markdown link without relaxing the renderer's handling of user input.
  plan.files['README.md'] = plan.files['README.md'].replace(markdownText(description), description);
  if (plan.files['docs/src/index.md']) {
    plan.files['docs/src/index.md'] = plan.files['docs/src/index.md'].replace(documenterText(description), description);
  }
  // The operation journal marker belongs to create/resume tests, not to these
  // continuously regenerated snapshots, which have no Factory operation.
  delete plan.files[markerPath];
  return {files: plan.files, uuid};
}
export async function publishSnapshot(directory: string, files: Record<string, string>, message: string, push: () => void = () => {git(directory, 'push', 'origin', 'HEAD:refs/heads/main');}) {
  // Git expands Windows short names and macOS /var symlinks; compare the
  // actual filesystem paths before allowing any snapshot file removal.
  assert.equal(await realpath(git(directory, 'rev-parse', '--show-toplevel')), await realpath(directory), 'Expected the snapshot checkout root');
  assert.equal(git(directory, 'symbolic-ref', '--short', 'HEAD'), 'main', 'Expected main branch');
  assert.equal(git(directory, 'status', '--porcelain', '--untracked-files=all'), '', 'Refusing a dirty snapshot checkout');
  const paths = Object.keys(files).sort();
  assert(paths.includes('Project.toml'), 'Snapshot must contain Project.toml');
  for (const path of paths) {
    assert(!isAbsolute(path) && !path.includes('\\') && !path.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git'), 'Invalid snapshot path');
  }
  assert(!git(directory, 'ls-files', '--stage').split('\n').some(line => /^(120000|160000) /.test(line)), 'Snapshot checkout cannot contain symlinks or submodules');
  const before = head(directory);
  const tracked = git(directory, 'ls-files', '-z').split('\0').filter(Boolean);
  const stale = tracked.filter(path => !(path in files));
  if (stale.length) git(directory, 'rm', '--', ...stale);
  for (const [path, content] of Object.entries(files)) {
    const target = join(directory, path);
    await mkdir(dirname(target), {recursive: true}); await writeFile(target, content);
  }
  git(directory, 'add', '-A', '--', '.');
  if (git(directory, 'diff', '--cached', '--name-only')) {
    git(directory, 'commit', '-m', message);
    // Never force or retry this push; an uncertain response requires the
    // operator to inspect the remote before starting a fresh checkout.
    try {push();} catch {throw new Error('Snapshot push was not confirmed. Inspect remote main before explicitly rerunning; no retry was made.');}
  }
  const after = head(directory);
  assert(after, 'Snapshot must have a commit');
  assert.equal(git(directory, 'ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0], after, 'Remote main changed');
  if (before) git(directory, 'merge-base', '--is-ancestor', before, after);
  assert.deepEqual(git(directory, 'ls-tree', '-rz', '--name-only', 'HEAD').split('\0').filter(Boolean).sort(), paths);
  for (const path of paths) assert.equal(await readFile(join(directory, path), 'utf8'), files[path], `Snapshot mismatch: ${path}`);
  return {before, after, changed: before !== after};
}
