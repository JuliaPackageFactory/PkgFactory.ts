import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const files = await readdir(process.argv[2], {recursive: true});
assert(!files.some(path => path.split(/[/\\]/).at(-1) === 'description-executed'), 'User description was executed by Documenter');
const html = await readFile(join(process.argv[2], 'docs/build/index.html'), 'utf8');
assert(html.includes('Plain description') && html.includes('description-executed') && html.includes('日本語'), 'Description must remain visible as text');
assert(!html.includes('<script>alert(1)</script>'), 'User HTML must remain inert');
console.log('Documenter rendered the adversarial description without executing it.');
