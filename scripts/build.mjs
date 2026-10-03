import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import './templates.mjs';
const ui = await build({entryPoints: ['packages/pkgfactory/src/web/app.ts'], bundle: true, write: false, minify: true, platform: 'browser'});
const assets = {js: ui.outputFiles[0].text, css: await readFile('packages/pkgfactory/src/web/style.css', 'utf8'), logo: await readFile('packages/pkgfactory/src/web/logo.svg', 'utf8'), github: await readFile('packages/pkgfactory/src/web/github.svg', 'utf8'), hero: (await readFile('packages/pkgfactory/src/web/hero.png')).toString('base64')};
await writeFile('packages/pkgfactory/src/web/assets.json', JSON.stringify(assets));
await mkdir('packages/pkgfactory/dist', {recursive: true});
for (const [name, entry] of Object.entries({cli: 'node/cli', index: 'index'})) {
  await build({entryPoints: [`packages/pkgfactory/src/${entry}.ts`], outfile: `packages/pkgfactory/dist/${name}.js`, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node24', sourcemap: true, banner: name === 'cli' ? {js: '#!/usr/bin/env node'} : undefined});
}
// Ship declarations for the complete public API, preserving its module structure.
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.build.json'], {stdio: 'inherit'});
await build({entryPoints: ['apps/cloudflare/src/worker.ts'], outfile: 'apps/cloudflare/dist/worker.js', bundle: true, platform: 'browser', format: 'esm', target: 'es2023', external: ['cloudflare:workers'], conditions: ['workerd', 'worker', 'browser'], sourcemap: true});
for (const name of ['README.md', 'LICENSE', 'NOTICE.md']) await copyFile(name, `packages/pkgfactory/${name}`);
for (const name of ['docs', 'examples']) await cp(name, `packages/pkgfactory/${name}`, {recursive: true});
