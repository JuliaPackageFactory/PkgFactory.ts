import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestTemplate } from '../apps/cloudflare/src/template-suggestion.js';
import { listTemplates } from '../packages/pkgfactory/src/core/spec.js';
import { errorResponse } from '../packages/pkgfactory/src/web/http.js';

const ai = (run: (model: string, input: any, options?: AiOptions) => Promise<unknown>) => ({run} as Pick<Ai, 'run'>);

test('Jev chooses among the existing templates through AI Gateway', async () => {
  const candidates = listTemplates();
  for (const candidate of candidates) {
    const result = await suggestTemplate(ai(async (model, input, options) => {
      assert.equal(model, 'typesafe/jev');
      assert.equal(input.state, 'Numerical quantum mechanics');
      assert.equal(input.questions.template.type, 'choice');
      assert.match(input.questions.template.instructions, /Julia package template/);
      const criteria = input.questions.template.criteria;
      assert.deepEqual(Object.keys(criteria), candidates.map(candidate => candidate.id));
      for (const candidate of candidates) assert.ok(criteria[candidate.id].startsWith(`${candidate.description}.`));
      assert.deepEqual(options, {gateway: {id: 'default', collectLog: false}});
      return {model: 'jev-1.13.0', answers: {template: {type: 'choice', choice: candidate.id, confidence: 0.85,
        probabilities: Object.fromEntries(candidates.map(option => [option.id, option.id === candidate.id ? 0.9 : 0.05]))}}};
    }), {description: '  Numerical quantum mechanics  '});
    assert.deepEqual(result, {template: candidate.id});
  }
});

test('empty or invalid descriptions never invoke inference', async () => {
  let calls = 0;
  const binding = ai(async () => {calls++; return {};});
  for (const description of ['', ' \n ']) assert.deepEqual(await suggestTemplate(binding, {description}), {template: null});
  for (const input of [null, [], {description: 42}, {description: 'x'.repeat(2001)}, {description: 'test', contexts: []}]) {
    await assert.rejects(suggestTemplate(binding, input), error => errorResponse(error).status === 400);
  }
  assert.equal(calls, 0);
});

test('binding failures and malformed choices produce a safe, optional-feature error', async () => {
  await assert.rejects(suggestTemplate(undefined, {description: 'Test'}), {code: 'suggestion_unavailable', status: 503});
  for (const result of [null, {}, {answers: {}}, {answers: {template: null}},
    {answers: {template: {type: 'choice', choice: 'unknown'}}}, {answers: {template: {type: 'choice', choice: '<script>alert(1)</script>'}}},
    {answers: {template: {type: 'choice', choice: 0}}}, {answers: {template: {type: 'choice'}}},
    {answers: {template: {type: 'score', choice: 'minimum'}}}, {response: [{id: 0, score: 0.9}]}]) {
    await assert.rejects(suggestTemplate(ai(async () => result), {description: 'Test'}), {code: 'suggestion_unavailable', status: 502});
  }
  await assert.rejects(suggestTemplate(ai(async () => {throw Error('hidden upstream details');}), {description: 'Test'}), error => {
    assert.doesNotMatch((error as Error).message, /hidden/); return errorResponse(error).status === 502;
  });
});
