// Maintainer utility: read the pinned reference without changing its checkout.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
const repository = process.argv[2];
if (!repository) throw new Error('Supply the reference repository path');
const git = (...args) => execFileSync('git', ['-c', `safe.directory=${repository.replaceAll('\\', '/')}`, '-C', repository, ...args]);
const ref = '7c7d4afeaa3b4b708726af4795c13c192fc3c948';
const paths = git('ls-tree', '-r', '--name-only', ref, 'templates').toString().trim().split('\n');
for (const path of paths) {
  const target = `packages/pkgfactory/${path}`;
  mkdirSync(dirname(target), {recursive: true});
  writeFileSync(target, git('show', `${ref}:${path}`));
}
console.log(`Imported ${paths.length} reference template files at ${ref}`);
