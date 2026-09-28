// One explicitly requested creation, or one explicit resume. Never deletes.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { Factory } from '../packages/pkgfactory/src/application/engine.js';
import { FileStore } from '../packages/pkgfactory/src/node/store.js';
import { GitHub } from '../packages/pkgfactory/src/github/client.js';
import { assertFreshTestRepository, freshTestName, selectedTemplate, SingleCreation } from './e2e/config.js';
const args = process.argv.slice(2);
if (args.some(a => !['--confirm-create-test-repository', '--confirm-resume', '--gh'].includes(a) && !a.startsWith('--template=') && !a.startsWith('--resume-plan='))) throw new Error('Use --confirm-create-test-repository for one new repository, or --resume-plan=ID --confirm-resume');
const resumeIds = args.filter(a => a.startsWith('--resume-plan='));
if (resumeIds.length > 1) throw new Error('Resume one plan at a time');
const resumeId = resumeIds[0]?.slice('--resume-plan='.length);
const create = args.includes('--confirm-create-test-repository');
if (resumeId ? create || !args.includes('--confirm-resume') : !create || args.includes('--confirm-resume')) throw new Error('Choose one new creation or one explicitly confirmed resume');
const template = selectedTemplate(args);
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || (args.includes('--gh') ? execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], {encoding: 'utf8'}).trim() : '');
if (!token) throw new Error('Set GITHUB_TOKEN or explicitly select --gh');
const signal = AbortSignal.timeout(120000);
const github = new GitHub(token, signal);
const user = await github.request('GET', '/user');
const credentials = {token, subject: String(user.id)};
const store = new FileStore('.tmp/e2e-state');
const factory = new Factory(store);
const saved = resumeId ? await store.get(resumeId) : null;
if (resumeId && !saved) throw new Error('Saved plan not found; do not create a replacement');
const plan = saved?.plan ?? await factory.preview({owner: 'JuliaPackageFactory', name: freshTestName(), authors: ['PkgFactory integration test'], template, description: 'PkgFactory creation and resume acceptance'}, credentials.subject);
assertFreshTestRepository(plan.repository);
await mkdir('artifacts', {recursive: true});
const path = `artifacts/github-e2e-${plan.spec.name}-${plan.id}.json`;
const record: any = {template: plan.spec.template, planId: plan.id, repository: plan.repository, resume: !!resumeId};
const save = () => writeFile(path, JSON.stringify(record, null, 2));
await save(); // Persist the identity before the first write, including failures.
try {
  if (resumeId) {
    record.beforeResume = await factory.status(plan.id, credentials, signal); await save();
    record.result = await factory.execute(plan.id, credentials, true, signal);
  } else {
    record.result = await new SingleCreation().run(plan.repository, () => factory.execute(plan.id, credentials, false, signal));
  }
} catch (error) {record.error = (error as Error).message; process.exitCode = 1;}
await save(); console.log(JSON.stringify({...record, report: path}));
