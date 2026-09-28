// Adds a test-only workflow to one of this runner's disposable repositories.
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { GitHub } from '../packages/pkgfactory/src/github/client.js';
import { base64, utf8, unbase64, decode } from '../packages/pkgfactory/src/core/encoding.js';
import { setTimeout as delay } from 'node:timers/promises';
const repository = process.argv[2];
if (!repository || !/^[\w-]+\/PkgFactoryPoc\d+\.jl$/.test(repository) || !process.argv.includes('--confirm')) throw new Error('Supply a PkgFactoryPoc test repository and --confirm');
const token = process.env.GITHUB_TOKEN || execFileSync('gh', ['auth', 'token'], {encoding: 'utf8'}).trim();
const github = new GitHub(token, AbortSignal.timeout(120000));
const python = await readFile('scripts/poc-tagbot.py', 'utf8');
const workflow = `name: Deploy key acceptance\non:\n  workflow_dispatch:\npermissions:\n  contents: write\njobs:\n  key:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n        with:\n          persist-credentials: false\n      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.12'\n      - run: pip install 'tagbot @ git+https://github.com/JuliaRegistries/TagBot.git@6e5c8281b63a21cc520fddebc89982dfe1807c91'\n      - name: Actual TagBot SSH setup and push\n        env:\n          DOCUMENTER_KEY: \${{ secrets.DOCUMENTER_KEY }}\n          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}\n        run: |\n          python - <<'PY'\n${python.trim().split('\n').map(s => '          ' + s).join('\n')}\n          PY\n`;
const path = `/repos/${repository}/contents/.github/workflows/DeployKeyPoc.yml`;
const existing = await github.request('GET', path, undefined, true);
if (!existing || decode(unbase64(existing.content.replace(/\s/g, ''))) !== workflow) {
  await github.request('PUT', path, {message: 'Add explicit deploy-key acceptance test', content: base64(utf8(workflow)), ...(existing ? {sha: existing.sha} : {})});
}
// GitHub indexes a newly committed workflow asynchronously. Poll only reads;
// dispatch each write once, after the workflow is visible.
let visible = false;
for (let attempt = 0; attempt < 20; attempt++) {
  if (await github.request('GET', `/repos/${repository}/actions/workflows/DeployKeyPoc.yml`, undefined, true)) {visible = true; break;}
  await delay(1000);
}
if (!visible) throw new Error('Workflow is not indexed yet. Inspect GitHub Actions before explicitly rerunning.');
await github.request('POST', `/repos/${repository}/actions/workflows/DeployKeyPoc.yml/dispatches`, {ref: 'main'});
await github.request('POST', `/repos/${repository}/actions/workflows/CI.yml/dispatches`, {ref: 'main'});
console.log(`Dispatched TagBot key PoC and Documenter CI: https://github.com/${repository}/actions`);
