import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAuthorSeparators, parseAuthors, workflowStates } from '../packages/pkgfactory/src/web/workflow.js';
import { page } from '../packages/pkgfactory/src/web/page.js';

test('each completed section advances one ready step, and invalidating an earlier step resets the flow', () => {
  assert.deepEqual(workflowStates([false, false, false, false, false]), ['ready', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  assert.deepEqual(workflowStates([true, false, false, false, false]), ['complete', 'ready', 'upcoming', 'upcoming', 'upcoming']);
  assert.deepEqual(workflowStates([true, true, false, false, false]), ['complete', 'complete', 'ready', 'upcoming', 'upcoming']);
  assert.deepEqual(workflowStates([true, true, true, false, false]), ['complete', 'complete', 'complete', 'ready', 'upcoming']);
  assert.deepEqual(workflowStates([true, true, true, true, false]), ['complete', 'complete', 'complete', 'complete', 'ready']);
  assert.deepEqual(workflowStates([true, true, true, true, true]), Array(5).fill('complete'));
  assert.deepEqual(workflowStates([true, true, true, true, true, false]), ['complete', 'complete', 'complete', 'complete', 'complete', 'ready']);
  assert.deepEqual(workflowStates([true, false, true, true, false]), ['complete', 'ready', 'upcoming', 'upcoming', 'upcoming']);
  assert.deepEqual(workflowStates([true, true, false, true, false]), ['complete', 'complete', 'ready', 'upcoming', 'upcoming']);
});

test('typed and pasted author separators become newlines without changing text length or losing names', () => {
  const input = 'Alice, Bob;Carol\r\nDaisuke，Eve；';
  const normalized = normalizeAuthorSeparators(input);
  assert.equal(normalized, 'Alice\n Bob\nCarol\r\nDaisuke\nEve\n');
  assert.equal(normalized.length, input.length);
  assert.equal(normalizeAuthorSeparators(normalized), normalized);
  assert.deepEqual(parseAuthors(input), ['Alice', 'Bob', 'Carol', 'Daisuke', 'Eve']);
  assert.deepEqual(parseAuthors(' , ; \n'), []);
  assert.deepEqual(parseAuthors('大野 修平\nAnne-Marie <anne@example.test>'), ['大野 修平', 'Anne-Marie <anne@example.test>']);
});

test('all workflow steps have text status, and resume controls are absent for every Web entry point', () => {
  for (const publicWeb of [false, true]) for (const authenticated of [false, true]) {
    const html = page('csrf', publicWeb, authenticated, 'https://pkgfactory.test');
    assert.equal((html.match(/class="step-state" role="status"/g) ?? []).length, 6);
    assert.doesNotMatch(html, /Resume interrupted setup|id="recovery"|id="planId"|id="resume"|id="status"/);
    assert.match(html, /id="codecov-row" class="automation-row"/);
    assert.match(html, /id="tagbot-row" class="automation-row"/);
    assert.match(html, /Repository settings/);
    assert.doesNotMatch(html, /refresh-apps|Refresh app status/);
    assert.doesNotMatch(html, /Registrator GitHub App|id="juliaregistrator-/);
    assert.match(html, /<select id="template"[^>]* required[^>]*><option value="" disabled selected>/);
    assert.doesNotMatch(html, /continue-template|Continue to automation|continue-automation|Continue to review|preview-button|Preview package/);
    assert.match(html, /id="create-spinner"[^>]*aria-hidden="true" hidden/);
    assert.match(html, /role="progressbar" aria-label="Repository creation in progress"/);
    assert.match(html, /data-step="6"[\s\S]*id="success-panel"/);
  }
});
