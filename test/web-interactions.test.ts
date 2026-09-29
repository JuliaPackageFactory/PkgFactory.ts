import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {page} from '../packages/pkgfactory/src/web/page.js';
const {JSDOM} = createRequire(import.meta.url)('jsdom');
const {outputFiles} = await build({entryPoints: ['packages/pkgfactory/src/web/app.ts'], bundle: true, write: false, platform: 'browser'});
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => {let resolve!: (value?: any) => void; const promise = new Promise<any>(r => {resolve = r;}); return {promise, resolve};};
async function fixture(options: {draft?: string; login?: string} = {}) {
  const dom = new JSDOM(page('csrf', true, true), {url: 'https://pkgfactory.test/', runScripts: 'outside-only'});
  const w = dom.window, $ = (id: string) => w.document.getElementById(id);
  const calls: {url: string; body: any}[] = [], scrolls: string[] = [];
  const state = {appsGate: undefined as ReturnType<typeof deferred> | undefined, createGate: deferred(),
    app: {state: 'unknown', selection: undefined as string | undefined}, appsFailure: false, failPreview: false, authExpired: false};
  let nextPlan = 0;
  if (options.draft) w.sessionStorage.setItem('pkgfactory-reconnect-settings', options.draft);
  w.fetch = async (url: string, init: any = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({url, body});
    if (state.authExpired) return {ok: false, status: 401, json: async () => ({error: 'Connect GitHub again.', code: 'auth'})};
    let result;
    if (url === '/api/github/profile') result = {user: {login: options.login ?? 'tester', name: 'Test Author'}, owners: [{login: 'tester', name: 'Tester', kind: 'user'}, {login: 'ExampleOrg', name: 'ExampleOrg', kind: 'organization'}]};
    else if (url === '/api/github/availability') result = {available: true, repository: `${body.owner}/${body.name}.jl`};
    else if (url === '/api/github/apps') {await state.appsGate?.promise; if (state.appsFailure) throw Error('Network unavailable'); result = {codecov: {...state.app}, juliaregistrator: {state: 'unknown'}};}
    else if (url === '/api/preview') {
      if (state.failPreview) return {ok: false, status: 502, json: async () => ({error: 'Preview temporarily unavailable'})};
      result = {id: `plan-${++nextPlan}`, repository: `${body.owner}/${body.name}.jl`, spec: body, files: {'Project.toml': body.description || 'Initial', 'src/TestPackage.jl': 'module TestPackage\nend'}};
    } else if (url === '/api/create') result = await state.createGate.promise;
    else if (url === '/api/status') result = {planId: body.planId, pagesUrl: 'https://docs.example.test/'};
    else throw Error(`Unexpected request ${url}`);
    return {ok: true, status: 200, json: async () => result};
  };
  w.matchMedia = () => ({matches: true});
  w.HTMLElement.prototype.scrollIntoView = function () {scrolls.push(this.dataset.step);};
  // Keep external links in the simulated page; application click handlers still run.
  w.document.addEventListener('click', (event: any) => {if (event.target.closest('a')) event.preventDefault();});
  w.eval(outputFiles[0].text);
  const wait = async (check: () => boolean) => {for (let i = 0; i < 400; i++) {if (check()) return; await delay(10);} throw Error('Timed out waiting for UI');};
  const input = (id: string, value: string) => {$(id).value = value; $(id).dispatchEvent(new w.Event('input', {bubbles: true}));};
  const select = (id: string, value: string) => {input(id, value); $(id).dispatchEvent(new w.Event('change', {bubbles: true}));};
  const count = (url: string) => calls.filter(call => call.url === url).length;
  const ready = () => !$('preview').hidden && $('review-spinner').hidden;
  const badge = (step: number) => w.document.querySelector(`[data-step="${step}"] .step-state`).textContent;
  await wait(() => !$('package-form').hidden && !$('package-fields').disabled);
  return {w, $, state, calls, scrolls, input, select, count, ready, badge, wait, close: () => w.close()};
}

test('Minimum skips apps, reports field errors, preserves inspected files, and never skips past automation', async () => {
  const f = await fixture(); const {$, input, select, wait, ready, w} = f;
  try {
    assert.equal($('refresh-apps'), null);
    input('package-name', 'TestPackage.jl');
    assert.match($('package-availability').textContent, /Remove the .jl suffix.*added automatically/);
    assert.equal($('package-availability').className, 'availability-status is-unavailable');
    await delay(500); assert.equal(f.count('/api/github/availability'), 0);
    input('package-name', 'TestPackage'); await wait(() => $('package-availability').classList.contains('is-available'));
    select('template', 'minimum'); await wait(ready);
    assert.equal(f.count('/api/github/apps'), 0); assert.deepEqual(f.scrolls, ['4']);
    for (const id of ['documenter', 'tagbot', 'codecov']) {assert.equal($(`${id}-state`).textContent, 'Not included'); assert.equal($(`${id}-state`).className, 'configured-pill');}
    assert.equal($('codecov-link').hidden, true); assert.equal($('apps-help').hidden, true);
    select('visibility', 'private'); await wait(ready); assert.equal($('private-docs-help').hidden, true);
    $('files').lastElementChild.click(); $('content').scrollTop = 80; $('content').scrollLeft = 15; $('files').scrollTop = 35;
    input('description', 'Updated description'); await wait(ready);
    assert.equal($('files').querySelector('[aria-pressed="true"]').textContent, 'src/TestPackage.jl');
    assert.equal($('content').scrollTop, 80); assert.equal($('content').scrollLeft, 15); assert.equal($('files').scrollTop, 35);
    input('authors', 'A'.repeat(201)); assert.equal($('authors-error').hidden, false); assert.match($('authors-error').textContent, /200 characters/); assert.equal($('authors').getAttribute('aria-invalid'), 'true');
    input('authors', Array.from({length: 21}, (_, i) => `Author ${i}`).join('\n')); assert.match($('authors-error').textContent, /20 authors/);
    input('authors', ''); assert.match($('authors-error').textContent, /at least one/);
    input('authors', 'Alice;Bob'); assert.equal($('authors').value, 'Alice\nBob'); assert.equal($('authors-error').hidden, true); await wait(ready);
    const gate = deferred(); f.state.appsGate = gate; select('template', 'simple');
    assert.equal($('private-docs-help').hidden, false); assert.match($('private-docs-help').querySelector('a').href, /docs.github.com/);
    assert.equal(f.badge(4), 'Checking'); gate.resolve(); f.state.appsGate = undefined; await wait(ready);
    assert.equal(f.badge(4), 'Completed'); assert.equal($('tagbot-state').textContent, 'Automatic'); assert.deepEqual(f.scrolls, ['4']);
    select('visibility', 'public'); assert.equal($('private-docs-help').hidden, true);
    await wait(ready); $('confirm').click(); const previews = f.count('/api/preview');
    const refreshGate = deferred(); f.state.appsGate = refreshGate; f.state.app = {state: 'installed', selection: 'selected'};
    $('codecov-link').click(); w.dispatchEvent(new w.Event('focus')); w.document.dispatchEvent(new w.Event('visibilitychange'));
    assert.equal(f.badge(4), 'Checking'); assert.equal(f.count('/api/github/apps'), 2);
    refreshGate.resolve(); f.state.appsGate = undefined; await wait(() => $('codecov-state').textContent === 'Installed');
    assert.equal(f.count('/api/preview'), previews); assert.equal($('confirm').checked, true);
    f.state.appsFailure = true; $('codecov-link').click(); w.dispatchEvent(new w.Event('focus'));
    await wait(() => $('codecov-state').textContent === 'Check on GitHub'); assert.equal(f.badge(4), 'Completed');
  } finally {f.close();}
});

test('template-first input waits for editing to end before advancing once', async () => {
  const f = await fixture();
  try {
    f.select('template', 'minimum'); f.$('package-name').focus(); f.input('package-name', 'TestPackage'); await f.wait(f.ready);
    assert.equal(f.w.document.activeElement.id, 'package-name'); assert.deepEqual(f.scrolls, []);
    f.$('package-name').blur(); await f.wait(() => f.scrolls.length === 1); assert.deepEqual(f.scrolls, ['4']);
    f.input('description', 'Edit'); await f.wait(f.ready); assert.deepEqual(f.scrolls, ['4']);
  } finally {f.close();}
});

test('IME input waits until committed and preview errors expose an explicit retry', async () => {
  const f = await fixture();
  try {
    f.input('package-name', 'TestPackage'); f.select('template', 'minimum'); await f.wait(f.ready);
    const before = f.count('/api/preview');
    f.$('authors').dispatchEvent(new f.w.CompositionEvent('compositionstart', {bubbles: true}));
    f.$('authors').value = 'Alice;Bob'; f.$('authors').dispatchEvent(new f.w.InputEvent('input', {bubbles: true, isComposing: true}));
    await delay(500); assert.equal(f.count('/api/preview'), before); assert.equal(f.$('authors-error').hidden, true);
    f.$('authors').dispatchEvent(new f.w.CompositionEvent('compositionend', {bubbles: true})); await f.wait(f.ready); assert.equal(f.$('authors').value, 'Alice\nBob');
    f.state.failPreview = true; f.input('description', 'New preview'); await f.wait(() => !f.$('retry-preview').hidden);
    assert.equal(f.badge(5), 'Needs attention');
    const failed = f.count('/api/preview'); await delay(500); assert.equal(f.count('/api/preview'), failed);
    f.state.failPreview = false; f.$('retry-preview').click(); assert.equal(f.badge(5), 'Preparing'); await f.wait(f.ready); assert.equal(f.badge(5), 'Ready');
  } finally {f.close();}
});

test('failed creation exposes attention and cannot resubmit the same request', async () => {
  const f = await fixture();
  try {
    f.input('package-name', 'TestPackage'); f.select('template', 'minimum'); await f.wait(f.ready);
    f.$('confirm').click(); f.$('create').click(); assert.equal(f.badge(5), 'Creating'); assert.equal(f.$('creation-progress').hidden, false);
    f.state.createGate.resolve({error: 'Inspect status, then explicitly resume', code: 'resume'});
    await f.wait(() => !f.$('creation-error').hidden && f.$('create-spinner').hidden);
    assert.equal(f.badge(5), 'Needs attention'); assert.equal(f.$('create').disabled, true); assert.equal(f.$('creation-recovery').hidden, false);
    f.$('create').click(); assert.equal(f.count('/api/create'), 1);
  } finally {f.close();}
});

test('success preserves review and links to Actions, documentation, and applicable Codecov access', async () => {
  const f = await fixture();
  try {
    f.state.app = {state: 'installed', selection: 'selected'};
    f.input('package-name', 'TestPackage'); f.select('template', 'simple'); await f.wait(f.ready);
    f.$('confirm').click(); f.$('create').click(); f.state.createGate.resolve({state: 'complete', repository: 'tester/TestPackage.jl'});
    await f.wait(() => !f.$('success-panel').hidden && f.$('documentation-link').textContent === 'Open documentation');
    assert.equal(f.$('preview').hidden, false); assert.equal(f.$('actions-link').href, 'https://github.com/tester/TestPackage.jl/actions');
    assert.equal(f.$('documentation-link').href, 'https://docs.example.test/'); assert.equal(f.$('codecov-followup').hidden, false);
    assert.match(f.$('build-status').textContent, /first documentation deployment/); assert.equal(f.scrolls.at(-1), '6');
    f.state.app = {state: 'installed', selection: 'all'}; f.$('codecov-followup').querySelector('a').click(); f.w.dispatchEvent(new f.w.Event('focus'));
    await f.wait(() => f.$('codecov-followup').hidden);
    f.$('create-another').click(); assert.equal(f.$('template').value, ''); assert.equal(f.$('success-panel').hidden, true);
  } finally {f.close();}
});

test('reconnect preserves only settings for the same account, never confirmation or creation', async () => {
  const f = await fixture(); let saved = '';
  try {
    f.input('package-name', 'TestPackage'); f.select('template', 'minimum'); f.input('description', 'Keep this'); await f.wait(f.ready);
    f.$('confirm').click(); f.state.authExpired = true; f.input('description', 'Keep this too');
    await f.wait(() => !f.$('reconnect-notice').hidden); assert.equal(f.$('create').disabled, true);
    f.$('reconnect').click(); saved = f.w.sessionStorage.getItem('pkgfactory-reconnect-settings');
    assert.doesNotMatch(saved, /planId|confirm|csrf|token/);
  } finally {f.close();}
  const restored = await fixture({draft: saved});
  try {await restored.wait(restored.ready); assert.equal(restored.$('description').value, 'Keep this too'); assert.equal(restored.$('confirm').checked, false); assert.equal(restored.count('/api/create'), 0); assert.equal(restored.w.sessionStorage.getItem('pkgfactory-reconnect-settings'), null);}
  finally {restored.close();}
  const other = await fixture({draft: saved, login: 'someone-else'});
  try {assert.equal(other.$('package-name').value, ''); assert.equal(other.$('description').value, ''); assert.equal(other.count('/api/create'), 0);}
  finally {other.close();}
});
