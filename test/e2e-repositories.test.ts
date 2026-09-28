import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import TOML from '@iarna/toml';
import { git, head, publishSnapshot, snapshot } from '../scripts/e2e/snapshots.js';
import { assertFreshTestRepository, freshTestName, selectedTemplate, SingleCreation, snapshotTarget, targets } from '../scripts/e2e/config.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'pkgfactory-snapshot-'));
  const remote = join(root, 'remote.git'), checkout = join(root, 'checkout');
  await mkdir(remote); git(remote, 'init', '--bare', '--initial-branch=main');
  git(root, 'clone', remote, checkout);
  git(checkout, 'config', 'user.name', 'Snapshot test');
  git(checkout, 'config', 'user.email', 'snapshot@example.invalid');
  git(checkout, 'config', 'core.autocrlf', 'false');
  return {root, remote, checkout};
}
const uuid = 'c1295625-87ea-430b-8a8e-cec21038bef7';
test('persistent snapshots initialize, preserve history, remove stale files and skip identical output', async () => {
  const {checkout, remote} = await fixture();
  assert.equal(head(checkout), null);
  const files = {'Project.toml': `name = "TestMinimum"\nuuid = "${uuid}"\n`, 'README.md': 'first\n', 'obsolete.txt': 'obsolete\n'};
  const first = await publishSnapshot(checkout, files, 'Initial snapshot');
  assert.equal(first.before, null); assert(first.changed);
  assert.equal(git(remote, 'rev-parse', 'main'), first.after);
  assert.equal((await publishSnapshot(checkout, files, 'Identical')).changed, false);
  const {['obsolete.txt']: _, ...retained} = files;
  const next = await publishSnapshot(checkout, retained, 'Deletion only');
  assert(next.changed); assert.equal(git(checkout, 'rev-parse', 'HEAD^'), first.after);
  assert.equal(git(remote, 'rev-parse', 'main'), next.after);
  await assert.rejects(readFile(join(checkout, 'obsolete.txt')));
  await writeFile(join(checkout, 'README.md'), 'uncommitted\n');
  await assert.rejects(publishSnapshot(checkout, retained, 'Dirty'), /dirty/);
  assert.equal(git(remote, 'rev-parse', 'main'), next.after);
  git(checkout, 'restore', 'README.md');
  await assert.rejects(publishSnapshot(checkout, {...retained, '../escape': 'bad'}, 'Unsafe path'), /Invalid snapshot path/);
  assert.equal(head(checkout), next.after);
});
test('renamed fixed repositories keep UUIDs and render the same output on subsequent runs', async () => {
  for (const target of targets) {
    const {checkout} = await fixture();
    const oldName = target.previousNames[0];
    await publishSnapshot(checkout, {'Project.toml': `name = "${oldName}"\nuuid = "${uuid}"\n`, [`src/${oldName}.jl`]: `module ${oldName}\nend\n`}, 'Legacy snapshot');
    const before = head(checkout);
    const expected = await snapshot(checkout, target);
    assert.equal(expected.uuid, uuid);
    assert.equal(TOML.parse(expected.files['Project.toml']).name, target.name);
    assert(!('.pkgfactory.json' in expected.files));
    await publishSnapshot(checkout, expected.files, 'Rename from PkgFactory');
    assert.equal(git(checkout, 'rev-parse', 'HEAD^'), before);
    await assert.rejects(readFile(join(checkout, `src/${oldName}.jl`)));
    const again = await snapshot(checkout, target);
    assert.deepEqual(again.files, expected.files);
    assert.equal((await publishSnapshot(checkout, again.files, 'No changes')).changed, false);
    await writeFile(join(checkout, 'Project.toml'), `name = "WrongPackage"\nuuid = "${uuid}"\n`);
    await assert.rejects(snapshot(checkout, target), /Unexpected package/);
    await writeFile(join(checkout, 'Project.toml'), `name = "${target.name}"\nuuid = "invalid"\n`);
    await assert.rejects(snapshot(checkout, target), /Invalid existing package UUID/);
    await writeFile(join(checkout, 'Project.toml'), `name = "${target.name}"\n`);
    await assert.rejects(snapshot(checkout, target), /Invalid existing package UUID/);
  }
  assert.throws(() => snapshotTarget('TemplateSimple'));
});
test('a concurrent remote update is never overwritten or retried', async () => {
  const {checkout, remote, root} = await fixture();
  const files = {'Project.toml': `name = "TestMinimum"\nuuid = "${uuid}"\n`};
  await publishSnapshot(checkout, files, 'Initial');
  const other = join(root, 'other'); git(root, 'clone', remote, other);
  git(other, 'config', 'user.name', 'Other'); git(other, 'config', 'user.email', 'other@example.invalid');
  await publishSnapshot(other, {...files, 'README.md': 'concurrent\n'}, 'Concurrent');
  const concurrent = head(other);
  await assert.rejects(publishSnapshot(checkout, {...files, 'README.md': 'stale\n'}, 'Stale'), /no retry/);
  assert.equal(git(remote, 'rev-parse', 'main'), concurrent);
});
test('one timestamped creation per run, including uncertain outcomes and parallel attempts', async () => {
  assert.equal(freshTestName(new Date('2026-09-28T09:10:11Z')), 'Test20260928091011');
  assert.equal(selectedTemplate([]), 'simple');
  assert.equal(selectedTemplate(['--template=minimum']), 'minimum');
  assert.throws(() => selectedTemplate(['--template=minimum', '--template=all-in-one']));
  for (const repository of ['ohno/Test20260928091011.jl', 'JuliaPackageFactory/TestSimple.jl', 'JuliaPackageFactory/Test123.jl', 'JuliaPackageFactory/PkgFactoryPoc20260928091011.jl']) assert.throws(() => assertFreshTestRepository(repository));
  let writes = 0;
  const one = new SingleCreation();
  const results = await Promise.allSettled([
    one.run('JuliaPackageFactory/Test20260928091011.jl', async () => {writes++; throw new Error('response lost');}),
    one.run('JuliaPackageFactory/Test20260928091012.jl', async () => {writes++;}),
  ]);
  assert(results.every(r => r.status === 'rejected')); assert.equal(writes, 1);
  await assert.rejects(one.run('JuliaPackageFactory/Test20260928091011.jl', async () => {writes++;}), /Only one/);
  assert.equal(writes, 1);
});
