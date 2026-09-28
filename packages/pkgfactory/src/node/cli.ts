import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Factory } from '../application/engine.js';
import { FileStore } from './store.js';
import { tokenFor } from './auth.js';
import { planPackage } from '../core/plan.js';
import { listTemplates } from '../core/spec.js';
import { localWeb } from './web.js';
import { mcpServer } from '../mcp/server.js';
const help = `PkgFactory — create Julia packages\n\n  pkgfactory templates\n  pkgfactory preview --spec package.json --out plan.json\n  pkgfactory create --plan plan.json --yes [--device | --gh]\n  pkgfactory status --plan-id UUID [--gh]\n  pkgfactory resume --plan-id UUID --yes [--gh]\n  pkgfactory web [--port 8787] [--device | --gh]\n  pkgfactory mcp --stdio [--read-only] [--gh]\n\nCredentials: GITHUB_TOKEN, GH_TOKEN, --gh (opt-in), or --device.\nState: --state-dir PATH or PKGFACTORY_STATE_DIR.\nDeploy keys: --key-algorithm ed25519 (default) or rsa4096.\n`;
export async function main(args = process.argv.slice(2)) {
  const {values, positionals} = parseArgs({args, allowPositionals: true, options: {
    spec: {type: 'string'}, out: {type: 'string'}, plan: {type: 'string'}, 'plan-id': {type: 'string'},
    yes: {type: 'boolean'}, gh: {type: 'boolean'}, device: {type: 'boolean'}, 'client-id': {type: 'string'},
    'state-dir': {type: 'string'}, 'read-only': {type: 'boolean'}, stdio: {type: 'boolean'}, port: {type: 'string'},
    'key-algorithm': {type: 'string'}, help: {type: 'boolean', short: 'h'}, version: {type: 'boolean'},
  }});
  const command = positionals[0];
  if (values.version) {console.log('0.1.0'); return;}
  if (values.help || !command) {console.log(help); return;}
  const print = (x: unknown) => console.log(JSON.stringify(x, null, 2));
  if (command === 'templates') {print(listTemplates()); return;}
  if (command === 'preview') {
    if (!values.spec) throw new Error('--spec is required');
    const plan = await planPackage(JSON.parse(await readFile(values.spec, 'utf8')));
    if (values.out) {await writeFile(values.out, JSON.stringify(plan, null, 2) + '\n', {flag: 'wx'}); console.error(`Saved ${plan.id} to ${values.out}`);} else print(plan);
    return;
  }
  if (!['create', 'resume', 'status', 'web', 'mcp'].includes(command)) throw new Error('Unknown command. Use --help.');
  if (command === 'mcp' && values.device) throw new Error('stdio MCP never starts interactive login. Use a PAT or --gh.');
  if (['create', 'resume'].includes(command) && !values.yes) throw new Error('Review the saved preview and supply --yes');
  const algorithm = values['key-algorithm'] ?? 'ed25519'; if (algorithm !== 'ed25519' && algorithm !== 'rsa4096') throw new Error('Invalid key algorithm');
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort()); process.once('SIGTERM', () => controller.abort());
  const token = await tokenFor({gh: values.gh, device: values.device, clientId: values['client-id']}, controller.signal);
  const factory = new Factory(new FileStore(resolve(values['state-dir'] || process.env.PKGFACTORY_STATE_DIR || join(homedir(), '.pkgfactory'))), {local: true, algorithm});
  const credentials = () => {if (!token) throw new Error('Set GITHUB_TOKEN or choose --device / --gh'); return {token, subject: 'local'};};
  if (command === 'web') {
    const port = Number(values.port ?? 8787); if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
    const {origin} = await localWeb(factory, token, port, controller.signal); console.error(`PkgFactory: ${origin}`); return;
  }
  if (command === 'mcp') {
    const server = mcpServer(factory, 'local', () => token ? credentials() : undefined, controller.signal, values['read-only']);
    process.stdin.once('end', () => {controller.abort(); void server.close();});
    controller.signal.addEventListener('abort', () => {void server.close();}, {once: true});
    await server.connect(new StdioServerTransport()); return;
  }
  let id = values['plan-id'];
  if (values.plan) {const plan = JSON.parse(await readFile(values.plan, 'utf8')); await factory.importPlan(plan, 'local'); id = plan.id;}
  if (!id) throw new Error('--plan or --plan-id is required');
  print(command === 'status' ? await factory.status(id, credentials(), controller.signal) : await factory.execute(id, credentials(), command === 'resume', controller.signal));
}
main().catch(error => {console.error(`PkgFactory: ${error.message}`); process.exitCode = 1;});
