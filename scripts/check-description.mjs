import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { descriptionPayload } from '../test/description-payload.ts';
const files = await readdir(process.argv[2], {recursive: true});
assert(!files.some(path => path.split(/[/\\]/).at(-1) === 'description-executed'), 'User description was executed by Documenter');
const html = await readFile(join(process.argv[2], 'docs/build/index.html'), 'utf8');
const block = html.match(/<p class="pkgfactory-description">([\s\S]*?)<\/p>/)?.[1];
assert(block, 'Rendered description paragraph is missing');
// Compare all displayed text, not just a few substrings. Decode exactly once,
// as a browser does, so user-supplied entity-looking text stays literal.
assert(!block.replaceAll('<br>', '').includes('<'), 'Description must not contain user HTML elements');
const text = block.replaceAll('<br>', '\n').replace(/&(amp|lt|gt|#\d+);/g, (_, entity) =>
  entity.startsWith('#') ? String.fromCodePoint(Number(entity.slice(1))) : ({amp: '&', lt: '<', gt: '>'})[entity]);
assert.equal(text, descriptionPayload, 'Documenter must display the entire original description without extra backslashes');
assert(html.includes("Fast, simple. It's here."), 'Ordinary punctuation must appear unchanged');
assert(!html.includes('<script>alert(1)</script>'), 'User HTML must remain inert');
// Documenter's own header has a javascript:; disclosure button. Check the
// article containing generated/user content, not that built-in navigation.
const article = html.match(/<article\b(?=[^>]*\bid="documenter-page")[^>]*>([\s\S]*?)<\/article>/)?.[1];
assert(article, 'Documenter article is missing');
assert(!/<a\b[^>]*\bhref\s*=\s*["']\s*javascript:/i.test(article), 'Description must not create javascript links');
console.log('Documenter rendered the adversarial description without executing it.');
