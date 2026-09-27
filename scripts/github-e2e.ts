// Explicit opt-in integration runner. Creates only fresh test repositories; never deletes.
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { Factory } from '../packages/pkgfactory/src/application/engine.js';
import { FileStore } from '../packages/pkgfactory/src/node/store.js';
import { GitHub } from '../packages/pkgfactory/src/github/client.js';
if (!process.argv.includes('--confirm-create-test-repositories')) throw new Error('Supply --confirm-create-test-repositories to run live writes');
const owner = process.env.PKGFACTORY_E2E_OWNER || 'JuliaPackageFactory';
const token = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token', '--hostname', 'github.com'], {encoding: 'utf8'}).trim();
const signal = AbortSignal.timeout(120000);
const github = new GitHub(token, signal);
const user = await github.request('GET', '/user');
const store = new FileStore('.tmp/e2e-state');
const factory = new Factory(store);
const run = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
await mkdir('artifacts', {recursive: true});
const records: any[] = [];
const resumeFile = process.argv.find(a => a.startsWith('--resume-file='))?.split('=')[1];
const existing = resumeFile ? JSON.parse(await readFile(resumeFile, 'utf8')) : null;
for (const [index, template] of ['minimum', 'simple', 'all-in-one'].entries()) {
  const plan = existing ? (await store.get(existing[index].planId))!.plan : await factory.preview({owner, name: `PkgFactoryPoc${run}${index}`, authors: ['PkgFactory integration test'], template, description: 'Temporary PkgFactory.ts acceptance test'}, String(user.id));
  const record: any = {template, planId: plan.id, repository: plan.repository}; records.push(record);
  try {record.result = await factory.execute(plan.id, {token, subject: String(user.id)}, !!existing);}
  catch (error: any) {record.error = error.message;}
  await writeFile('artifacts/github-e2e.json', JSON.stringify(records, null, 2));
  console.log(JSON.stringify(record));
}
if (records.some(r => r.error)) process.exitCode = 1;
