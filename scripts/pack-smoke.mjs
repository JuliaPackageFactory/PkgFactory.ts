import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const npmCli = process.env.npm_execpath || (process.platform === 'win32' ? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') : null);
const npmRun = (args, cwd = process.cwd()) => execFileSync(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...args] : args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
await mkdir('.tmp/pack-smoke', {recursive: true});
const packed = JSON.parse(npmRun(['pack', '--workspace', '@juliapackagefactory/pkgfactory', '--pack-destination', '.tmp/pack-smoke', '--json']));
assert.ok(!packed[0].files.some(({path}) => path.startsWith('templates/') || path.endsWith('/templates.json')));
const destination = resolve('.tmp/pack-smoke/install'); await mkdir(destination, {recursive: true});
await writeFile(`${destination}/package.json`, '{"private":true,"type":"module"}');
const tarball = packed[0].filename.replace(/^@/, '').replaceAll('/', '-');
npmRun(['install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', resolve('.tmp/npm-cache'), resolve('.tmp/pack-smoke', tarball)], destination);
const bin = `${destination}/node_modules/@juliapackagefactory/pkgfactory/dist/cli.js`;
assert.match(execFileSync(process.execPath, [bin, 'templates'], {encoding: 'utf8'}), /all-in-one/);
const spec = `${destination}/spec.json`; await writeFile(spec, JSON.stringify({owner: 'tester', name: 'PackSmoke', authors: ['Tester'], template: 'all-in-one'}));
const preview = JSON.parse(execFileSync(process.execPath, [bin, 'preview', '--spec', spec], {encoding: 'utf8'}));
assert.ok(preview.files['.github/workflows/CI.yml']); assert.ok(preview.files['examples/PackSmoke.ipynb']);
for (const template of ['minimum', 'simple']) {
  await writeFile(spec, JSON.stringify({owner: 'tester', name: 'PackSmoke', authors: ['Tester'], template}));
  const plan = JSON.parse(execFileSync(process.execPath, [bin, 'preview', '--spec', spec], {encoding: 'utf8'}));
  assert.ok(plan.files['src/PackSmoke.jl']);
}
const env = {...process.env, GITHUB_TOKEN: '', GH_TOKEN: '', PKGFACTORY_STATE_DIR: `${destination}/state`};
const transport = new StdioClientTransport({command: process.execPath, args: [bin, 'mcp', '--stdio'], env, stderr: 'pipe'});
const client = new Client({name: 'pack-smoke', version: '1'});
try {await client.connect(transport); assert.equal((await client.listTools()).tools.length, 5);} finally {await client.close();}
const child = spawn(process.execPath, [bin, 'web', '--port', '0'], {env, stdio: ['ignore', 'ignore', 'pipe']});
try {
  const origin = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Web startup timeout')), 15000);
    child.stderr.on('data', data => {const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) {clearTimeout(timeout); resolve(match[0]);}});
    child.on('error', reject); child.on('exit', () => {clearTimeout(timeout); reject(new Error('Web exited'));});
  });
  assert.match(await (await fetch(origin)).text(), /PkgFactory/);
} finally {child.kill();}
console.log(`Tarball verified: ${packed[0].filename}; CLI, offline template assets, stdio MCP, local Web`);
