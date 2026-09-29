import { test } from 'node:test';
import assert from 'node:assert/strict';
import TOML from '@iarna/toml';
import YAML from 'yaml';
import { planPackage, validatePlan } from '../packages/pkgfactory/src/core/plan.js';
import { templates, specSchema } from '../packages/pkgfactory/src/core/spec.js';
import { packageNameError } from '../packages/pkgfactory/src/core/package-name.js';
import { errorResponse } from '../packages/pkgfactory/src/web/http.js';
import { descriptionPayload } from './description-payload.js';
import { markdownText, documenterText } from '../packages/pkgfactory/src/core/markdown.js';

test('description is literal Markdown in README and Documenter, while repository metadata stays original', async () => {
  for (const template of templates) {
    const plan = await planPackage({owner: 'tester', name: 'SafePackage', authors: ['Tester'], template, description: descriptionPayload});
    assert.equal(plan.spec.description, descriptionPayload);
    assert(plan.files['README.md'].includes(markdownText(descriptionPayload)));
    if (template !== 'minimum') assert(plan.files['docs/src/index.md'].includes(documenterText(descriptionPayload)));
  }
  assert.doesNotMatch(markdownText(descriptionPayload), /```|~~~|<script>/);
  const block = documenterText(descriptionPayload).split('\n');
  assert.equal(block.length, 3);
  assert.doesNotMatch(block[1], /```|~~~|<script>|<img|<javascript:/);
  assert(block[1].includes("Fast, simple. It's here."));
});
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
test('Julia naming rules and their error messages agree across the UI, core, and HTTP errors', async () => {
  const cases = [
    ['JuliaPkg', /must not contain/], ['MyJuliaPkg', /must not contain/], ['MyjuliaPkg', /must not contain/],
    ['JustInTime', /must not start/], ['algebra', /uppercase ASCII/], ['Linear_algebra', /underscores or hyphens/],
    ['Linear-algebra', /underscores or hyphens/], ['Math+Physics', /ASCII letters and digits/],
    ['Eigen京', /ASCII letters and digits/], ['UPPER', /lowercase/], ['UPPER123', /lowercase/],
    ['Cake', /at least 5/], ['VMCjl', /must not end/], ['With Space', /spaces and symbols/],
    ['A'.repeat(100) + 'a', /at most 100/],
  ] as const;
  for (const [name, pattern] of cases) {
    assert.match(packageNameError(name), pattern, name);
    const parsed = specSchema.safeParse({owner: 'tester', name, authors: ['Tester']});
    assert.equal(parsed.success, false, name);
    if (!parsed.success) {
      assert.match(parsed.error.issues[0].message, pattern);
      assert.match((await errorResponse(parsed.error).json() as any).error, pattern);
    }
  }
  for (const name of ['Physics', 'MyPkg', 'Upper123', 'A' + 'a'.repeat(99)]) {
    assert.equal(packageNameError(name), ''); assert.equal(specSchema.parse({owner: 'tester', name, authors: ['Tester']}).name, name);
  }
  // The Web warns about redundant suffixes; existing programmatic callers may normalize one.
  assert.match(packageNameError('Physics.jl'), /Remove the .jl suffix.*added automatically/);
  assert.equal(specSchema.parse({owner: 'tester', name: 'Physics.jl', authors: ['Tester']}).name, 'Physics');
});
