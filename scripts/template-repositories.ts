// Updates only the three existing, dedicated template repositories. Never creates one.
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { GitHub } from '../packages/pkgfactory/src/github/client.js';
import { snapshotTarget, sourceRepository, targets } from './e2e/config.js';
import { git, publishSnapshot, snapshot } from './e2e/snapshots.js';

const args = process.argv.slice(2);
const publish = args.includes('--publish');
if (args.some(a => !['--publish', '--gh'].includes(a) && !a.startsWith('--package='))) throw new Error('Usage: template-repositories.ts [--package=TestMinimum|TestSimple|TestAllInOne] [--publish] [--gh]');
if (process.env.GITHUB_ACTIONS && (process.env.GITHUB_REPOSITORY !== sourceRepository || process.env.GITHUB_REF !== 'refs/heads/main')) throw new Error('Repository E2E may run only on the trusted main branch');
const requested = args.filter(a => a.startsWith('--package='));
if (requested.length > 1) throw new Error('Choose one package, or omit --package for all three existing repositories');
const selected = requested.length ? [snapshotTarget(requested[0].slice('--package='.length))] : targets;
const token = process.env.PKGFACTORY_E2E_TOKEN || process.env.GH_TOKEN || (args.includes('--gh') ? execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], {encoding: 'utf8'}).trim() : '');
if (!token) throw new Error('Set PKGFACTORY_E2E_TOKEN or explicitly select --gh');
const github = new GitHub(token, AbortSignal.timeout(120000));
const source = git('.', 'rev-parse', 'HEAD');
if (!/^[a-f\d]{40}$/.test(source)) throw new Error('Expected a source commit');
if (publish && git('.', 'status', '--porcelain', '--untracked-files=all')) throw new Error('Commit the generator changes before publishing snapshots');
const user = await github.request('GET', '/user');
const root = resolve('.tmp/template-repositories'); await mkdir(root, {recursive: true});
await mkdir('artifacts', {recursive: true});
const report: any = {source, publish, results: []};
// Per-command helper uses the token from the child environment, never from a
// remote URL, persisted Git config, or command argument. Julia never sees it.
const authenticatedGit = (directory: string, ...command: string[]) => execFileSync('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', '-C', directory, ...command],
  {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: {...process.env, GH_TOKEN: token, GIT_TERMINAL_PROMPT: '0'}});
try {
  for (const target of selected) {
    const repository = `JuliaPackageFactory/${target.name}.jl`;
    const remote = await github.request('GET', `/repos/${repository}`);
    if (remote.full_name !== repository || remote.default_branch !== 'main' || remote.archived) throw new Error(`Expected existing writable ${repository} on main`);
    const parent = await mkdtemp(join(root, `${target.name}-`));
    const directory = join(parent, target.name);
    authenticatedGit(parent, '-c', 'core.autocrlf=false', '-c', 'init.defaultBranch=main', 'clone', '--single-branch', `https://github.com/${repository}.git`, directory);
    git(directory, 'config', 'core.autocrlf', 'false');
    git(directory, 'config', 'user.name', user.login);
    git(directory, 'config', 'user.email', `${user.id}+${user.login}@users.noreply.github.com`);
    const expected = await snapshot(directory, target);
    const result: any = {repository, template: target.template, uuid: expected.uuid, packagePath: directory};
    report.results.push(result);
    if (publish) {
      Object.assign(result, await publishSnapshot(directory, expected.files, `Update ${target.name} from PkgFactory.ts ${source}\n\nhttps://github.com/${sourceRepository}/commit/${source}`,
        () => {authenticatedGit(directory, 'push', 'origin', 'HEAD:refs/heads/main');}));
    } else {
      // Preview the complete intended tree without changing the checkout.
      const out = join(parent, 'preview');
      for (const [path, content] of Object.entries(expected.files)) {
        await mkdir(resolve(out, path, '..'), {recursive: true}); await writeFile(join(out, path), content);
      }
      result.previewPath = out;
    }
    console.log(JSON.stringify(result));
    if (process.env.GITHUB_OUTPUT && selected.length === 1) await appendFile(process.env.GITHUB_OUTPUT, `package_path=${directory}\n`);
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### [${repository}](https://github.com/${repository})\n\nSource: [${source}](https://github.com/${sourceRepository}/commit/${source})\n\n${result.changed ? `Updated [${result.after}](https://github.com/${repository}/commit/${result.after})` : 'No generated changes; no commit added.'}\n\nUUID: ${expected.uuid}\n`);
  }
} catch (error) {
  report.failed = true;
  // Never serialize child-process errors (they can include an environment).
  console.error(error instanceof Error && !('stdout' in error) ? error.message : 'Repository E2E stopped. Inspect remote main before explicitly rerunning.');
  process.exitCode = 1;
} finally {
  await writeFile(`artifacts/template-repositories${selected.length === 1 ? '-' + selected[0].name : ''}.json`, JSON.stringify(report, null, 2));
}
