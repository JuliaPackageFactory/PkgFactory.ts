import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../templates/', import.meta.url);
const manifest: Record<string, string> = {};
async function walk(dir: URL, prefix = '') {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) await walk(new URL(entry.name + '/', dir), path + '/');
    else manifest[path] = (await readFile(new URL(entry.name, dir), 'utf8')).replaceAll('\r\n', '\n');
  }
}
await walk(root);
await mkdir(new URL('../src/core/', import.meta.url), {recursive: true});
await writeFile(new URL('../src/core/templates.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
