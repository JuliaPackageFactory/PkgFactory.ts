import { join } from 'node:path';
import { planPackage } from '../../src/core/plan.js';
import { pagesPlaceholder } from '../../src/core/pages.js';
import { targets } from '../e2e/config.js';
import { writeFiles } from '../e2e/snapshots.js';
import { descriptionPayload } from '../support/description-payload.js';
for (const {template, name} of targets) {
  const plan = await planPackage({owner: 'JuliaPackageFactory', name, authors: ['PkgFactory CI'], template, description: descriptionPayload});
  await writeFiles(join('artifacts', 'generated', template), plan.files);
  await writeFiles(join('artifacts', 'gh-pages', template), pagesPlaceholder(plan.repository));
}
