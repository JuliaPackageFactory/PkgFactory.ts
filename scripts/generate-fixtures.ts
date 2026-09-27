import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { planPackage } from '../packages/pkgfactory/src/core/plan.js';
for (const template of ['minimum', 'simple', 'all-in-one']) {
  const plan = await planPackage({owner: 'JuliaPackageFactory', name: 'FixturePackage', authors: ['PkgFactory CI'], template});
  for (const [path, contents] of Object.entries(plan.files)) {
    const target = join('artifacts', 'generated', template, path); await mkdir(join(target, '..'), {recursive: true}); await writeFile(target, contents);
  }
}
