import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { planPackage } from '../packages/pkgfactory/src/core/plan.js';
import { targets } from './e2e/config.js';
for (const {template, name} of targets) {
  const plan = await planPackage({owner: 'JuliaPackageFactory', name, authors: ['PkgFactory CI'], template});
  for (const [path, contents] of Object.entries(plan.files)) {
    const target = join('artifacts', 'generated', template, path); await mkdir(join(target, '..'), {recursive: true}); await writeFile(target, contents);
  }
}
