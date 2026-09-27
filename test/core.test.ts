import { test } from 'node:test';
import assert from 'node:assert/strict';
import TOML from '@iarna/toml';
import YAML from 'yaml';
import { planPackage, validatePlan } from '../packages/pkgfactory/src/core/plan.js';
import { templates } from '../packages/pkgfactory/src/core/spec.js';
for (const template of templates) test(`render and parse ${template}`, async () => {
  const plan = await planPackage({owner: 'JuliaPackageFactory', name: 'Example.jl', authors: ['大野 "Shuhei" \\ $x\nName', 'Alice'], template},
    {id: 'plan', uuid: 'f5dc8578-e5a2-4e82-bf9a-9022e5ef4973', date: '2026-09-28T00:00:00.000Z'});
  for (const [path, value] of Object.entries(plan.files)) {
    if (path.endsWith('.toml')) TOML.parse(value);
    if (path.endsWith('.yml') || path.endsWith('.cff')) YAML.parse(value);
    if (path.endsWith('.ipynb') || path.endsWith('.json')) JSON.parse(value);
    assert.doesNotMatch(value, /\{\{\{\w+\}\}\}/);
  }
  assert.ok(plan.files['src/Example.jl']);
  assert.deepEqual(TOML.parse(plan.files['Project.toml']).authors, plan.spec.authors);
  if (template !== 'minimum') assert.match(plan.files['docs/make.jl'], /\\\$x/);
  assert.match(plan.files['.github/workflows/CI.yml'], /\$\{\{ github.workflow \}\}/);
  await validatePlan(plan);
  plan.files['Project.toml'] += '\n# tampered';
  await assert.rejects(validatePlan(plan));
});
test('input does not allow path or Julia code injection', async () => {
  for (const name of ['../X', 'A;exit()', 'a', 'A$B']) await assert.rejects(planPackage({owner: 'a', name, authors: ['a']}));
});
