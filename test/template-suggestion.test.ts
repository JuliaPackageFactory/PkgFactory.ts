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
      assert.deepEqual(options, {gateway: {id: 'default', collectLog: false}, returnRawResponse: true});
      return Response.json({model: 'jev-1.13.0', answers: {template: {type: 'choice', choice: candidate.id, confidence: 0.85,
        probabilities: Object.fromEntries(candidates.map(option => [option.id, option.id === candidate.id ? 0.9 : 0.05]))}}});
    }), {description: '  Numerical quantum mechanics  '});
    assert.deepEqual(result, {template: candidate.id});
  }
});

test('Jev JSON with a charset is parsed instead of treating the binding stream as an answer', async () => {
  // workerd's Ai.run only auto-parses an exact application/json Content-Type.
  // https://github.com/cloudflare/workerd/blob/main/src/cloudflare/internal/ai-api.ts
  const binding = ai(async (_model, _input, options) => {
    const response = new Response(JSON.stringify({answers: {template: {type: 'choice', choice: 'all-in-one'}}}),
      {headers: {'Content-Type': 'application/json; charset=utf-8'}});
    return options?.returnRawResponse ? response : response.body;
  });
  assert.deepEqual(await suggestTemplate(binding, {description: 'Scientific computing'}), {template: 'all-in-one'});
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
    await assert.rejects(suggestTemplate(ai(async () => Response.json(result)), {description: 'Test'}), {code: 'suggestion_response', status: 502});
  }
  await assert.rejects(suggestTemplate(ai(async () => {throw Error('hidden upstream details');}), {description: 'Test'}), error => {
    assert.match((error as Error).message, /Could not reach Jev/);
    assert.doesNotMatch((error as Error).message, /hidden/); return errorResponse(error).status === 502;
  });
});

test('upstream HTTP failures expose the status without leaking response bodies', async t => {
  const logs = t.mock.method(console, 'warn', () => {});
  for (const status of [400, 401, 402, 403, 429, 500, 503]) {
    const response = new Response('private upstream details', {status});
    await assert.rejects(suggestTemplate(ai(async () => response), {description: 'private package description'}), asyncError => {
      assert.match((asyncError as Error).message, new RegExp(`HTTP ${status}`));
      assert.doesNotMatch((asyncError as Error).message, /private/);
      return errorResponse(asyncError).status === 502;
    });
    assert.equal(response.bodyUsed, true);
    assert.deepEqual(JSON.parse(logs.mock.calls.at(-1)!.arguments[0]),
      {event: 'template_suggestion_failed', reason: 'upstream', upstreamStatus: status});
  }
});

test('invalid JSON and invalid choices have separate safe diagnostics', async t => {
  const logs = t.mock.method(console, 'warn', () => {});
  await assert.rejects(suggestTemplate(ai(async () => new Response('<html>private</html>')), {description: 'private'}),
    {code: 'suggestion_json', status: 502});
  assert.deepEqual(JSON.parse(logs.mock.calls.at(-1)!.arguments[0]),
    {event: 'template_suggestion_failed', reason: 'json', upstreamStatus: 200});
  await assert.rejects(suggestTemplate(ai(async () => Response.json({answers: {template: {type: 'choice', choice: 'private'}}})), {description: 'private'}),
    {code: 'suggestion_response', status: 502});
  assert.deepEqual(JSON.parse(logs.mock.calls.at(-1)!.arguments[0]),
    {event: 'template_suggestion_failed', reason: 'response', upstreamStatus: 200});
  assert.doesNotMatch(JSON.stringify(logs.mock.calls), /private/);
});
