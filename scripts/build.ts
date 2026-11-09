import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import './templates.ts';
import './assets.ts';
await mkdir('dist/cloudflare', {recursive: true});
// The npm package: CLI and library, with declarations for the public API.
for (const [name, entry] of Object.entries({cli: 'cli/main', index: 'index'})) {
  await build({entryPoints: [`src/${entry}.ts`], outfile: `dist/${name}.js`, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24', sourcemap: true, banner: name === 'cli' ? {js: '#!/usr/bin/env node'} : undefined});
}
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.build.json'], {stdio: 'inherit'});
// The Worker. package.json#files keeps dist/cloudflare out of the npm package.
await build({entryPoints: ['src/cloudflare/worker.ts'], outfile: 'dist/cloudflare/worker.js', bundle: true, platform: 'browser', format: 'esm', target: 'es2023', external: ['cloudflare:workers'], conditions: ['workerd', 'worker', 'browser'], sourcemap: true});
