// One explicitly requested creation. Never deletes, never retries.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { Factory } from '../packages/pkgfactory/src/application/engine.js';
import { GitHub } from '../packages/pkgfactory/src/github/client.js';
import { assertFreshTestRepository, freshTestName, selectedTemplate, SingleCreation } from './e2e/config.js';
const args = process.argv.slice(2);
if (args.some(a => !['--confirm-create-test-repository', '--gh'].includes(a) && !a.startsWith('--template='))) throw new Error('Use --confirm-create-test-repository [--template=...] [--gh]');
if (!args.includes('--confirm-create-test-repository')) throw new Error('Pass --confirm-create-test-repository to create one new repository');
const template = selectedTemplate(args);
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || (args.includes('--gh') ? execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], {encoding: 'utf8'}).trim() : '');
if (!token) throw new Error('Set GITHUB_TOKEN or explicitly select --gh');
const signal = AbortSignal.timeout(120000);
const github = new GitHub(token, signal);
const user = await github.request('GET', '/user');
const credentials = {token, subject: String(user.id)};
const factory = new Factory();
const plan = await factory.preview({owner: 'JuliaPackageFactory', name: freshTestName(), authors: ['PkgFactory integration test'], template, description: 'PkgFactory creation acceptance'});
assertFreshTestRepository(plan.repository);
await mkdir('artifacts', {recursive: true});
const path = `artifacts/github-e2e-${plan.spec.name}-${plan.id}.json`;
const record: any = {template: plan.spec.template, planId: plan.id, repository: plan.repository};
const save = () => writeFile(path, JSON.stringify(record, null, 2));
await save(); // Persist the identity before the first write, including failures.
try {
  record.result = await new SingleCreation().run(plan.repository, () => factory.execute(plan, credentials, signal));
} catch (error) {record.error = (error as Error).message; process.exitCode = 1;}
await save(); console.log(JSON.stringify({...record, report: path}));
