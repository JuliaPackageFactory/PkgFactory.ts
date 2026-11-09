import { join } from 'node:path';
import { planPackage } from '../../src/core/plan.js';
import { targets } from '../e2e/config.js';
import { writeFiles } from '../e2e/snapshots.js';
import { descriptionPayload } from '../support/description-payload.js';
for (const {template, name} of targets) {
  const plan = await planPackage({owner: 'JuliaPackageFactory', name, authors: ['PkgFactory CI'], template, description: descriptionPayload});
  await writeFiles(join('artifacts', 'generated', template), plan.files);
}
