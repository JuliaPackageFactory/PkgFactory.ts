import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestTemplate } from '../apps/cloudflare/src/template-suggestion.js';
import { listTemplates } from '../packages/pkgfactory/src/core/spec.js';
import { errorResponse } from '../packages/pkgfactory/src/web/http.js';

const ai = (run: (model: string, input: any) => Promise<unknown>) => ({run} as Pick<Ai, 'run'>);

test('Workers AI ranks the existing templates and maps context IDs to template IDs', async () => {
  const candidates = listTemplates();
  for (const [id, candidate] of candidates.entries()) {
    const result = await suggestTemplate(ai(async (model, input) => {
      assert.equal(model, '@cf/baai/bge-reranker-base');
      assert.equal(input.query, 'Numerical quantum mechanics'); assert.equal(input.top_k, 1);
      assert.equal(input.contexts.length, candidates.length);
      for (const [i, context] of input.contexts.entries()) assert.ok(context.text.startsWith(`${candidates[i].id}: ${candidates[i].description}.`));
      return {response: [{id, score: 0.85}]};
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

test('binding failures and malformed rankings produce a safe, optional-feature error', async () => {
  await assert.rejects(suggestTemplate(undefined, {description: 'Test'}), {code: 'suggestion_unavailable', status: 503});
  for (const result of [null, {}, {response: []}, {response: [{id: -1, score: 1}]}, {response: [{id: 3, score: 1}]},
    {response: [{id: 1.5, score: 1}]}, {response: [{id: 0}]}, {response: [{id: 0, score: NaN}]}]) {
    await assert.rejects(suggestTemplate(ai(async () => result), {description: 'Test'}), {code: 'suggestion_unavailable', status: 502});
  }
  await assert.rejects(suggestTemplate(ai(async () => {throw Error('hidden upstream details');}), {description: 'Test'}), error => {
    assert.doesNotMatch((error as Error).message, /hidden/); return errorResponse(error).status === 502;
  });
});
