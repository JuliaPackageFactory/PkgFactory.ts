import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const web = new URL('../src/web/', import.meta.url);
const asset = (name: string, encoding: BufferEncoding = 'utf8') => readFile(new URL('assets/' + name, web), encoding);
const client = await build({entryPoints: [fileURLToPath(new URL('client/app.ts', web))], bundle: true, write: false, minify: true, platform: 'browser'});
const assets = {js: client.outputFiles[0].text, css: await asset('style.css'), logo: await asset('logo.svg'), github: await asset('github.svg'), hero: await asset('hero.png', 'base64'), ogp: await asset('ogp.png', 'base64')};
await writeFile(new URL('assets.json', web), JSON.stringify(assets));
