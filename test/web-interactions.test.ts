import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {page} from '../packages/pkgfactory/src/web/page.js';
const {JSDOM} = createRequire(import.meta.url)('jsdom');
const {outputFiles} = await build({entryPoints: ['packages/pkgfactory/src/web/app.ts'], bundle: true, write: false, platform: 'browser'});
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const suggested = {template: 'all-in-one', probabilities: {minimum: 0.05, simple: 0.15, 'all-in-one': 0.8}};
const suggestionMessage = 'Jev recommends All-in-one. (minimum: 5%, simple: 15%, all-in-one: 80%)';
const deferred = () => {let resolve!: (value?: any) => void; const promise = new Promise<any>(r => {resolve = r;}); return {promise, resolve};};
async function fixture(options: {draft?: string; login?: string; suggestions?: boolean; language?: string} = {}) {
  const dom = new JSDOM(page('csrf', true, true, 'https://pkgfactory.test', options.suggestions), {url: 'https://pkgfactory.test/', runScripts: 'outside-only'});
  const w = dom.window, $ = (id: string) => w.document.getElementById(id);
  if (options.language) Object.defineProperty(w.navigator, 'language', {value: options.language});
  const calls: {url: string; body: any; signal?: AbortSignal}[] = [], scrolls: string[] = [];
  const state = {appsGate: undefined as ReturnType<typeof deferred> | undefined, createGate: deferred(),
    app: {state: 'unknown', selection: undefined as string | undefined}, appsFailure: false, failPreview: false, authExpired: false,
    suggestionGate: undefined as ReturnType<typeof deferred> | undefined, suggestionFailure: false, suggestionApiError: ''};
  let nextPlan = 0;
  if (options.draft) w.sessionStorage.setItem('pkgfactory-reconnect-settings', options.draft);
  w.fetch = async (url: string, init: any = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({url, body, signal: init.signal});
    if (state.authExpired) return {ok: false, status: 401, json: async () => ({error: 'Connect GitHub again.', code: 'auth'})};
    let result;
    if (url === '/api/github/profile') result = {user: {login: options.login ?? 'tester', name: 'Test Author'}, owners: [{login: 'tester', name: 'Tester', kind: 'user'}, {login: 'ExampleOrg', name: 'ExampleOrg', kind: 'organization'}]};
    else if (url === '/api/github/availability') result = {available: true, repository: `${body.owner}/${body.name}.jl`};
    else if (url === '/api/github/apps') {await state.appsGate?.promise; if (state.appsFailure) throw Error('Network unavailable'); result = {codecov: {...state.app}, juliaregistrator: {state: 'unknown'}};}
    else if (url === '/api/preview') {
      if (state.failPreview) return {ok: false, status: 502, json: async () => ({error: 'Preview temporarily unavailable'})};
      result = {id: `plan-${++nextPlan}`, repository: `${body.owner}/${body.name}.jl`, spec: body, files: {'Project.toml': body.description || 'Initial', 'src/TestPackage.jl': 'module TestPackage\nend'}};
    } else if (url === '/api/template-suggestion') {
      if (state.suggestionFailure) throw Error('Workers AI unavailable');
      if (state.suggestionApiError) return {ok: false, status: 502, json: async () => ({error: state.suggestionApiError, code: 'suggestion_upstream'})};
      result = state.suggestionGate ? await state.suggestionGate.promise : suggested;
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

// Exercise the bundled application with a virtual clock for requests and timeouts.
function suggestionClock(t: import('node:test').TestContext, f: Awaited<ReturnType<typeof fixture>>) {
  t.mock.timers.enable({apis: ['setTimeout']});
  f.w.setTimeout = globalThis.setTimeout; f.w.clearTimeout = globalThis.clearTimeout;
  return async (ms: number) => {t.mock.timers.tick(ms); await new Promise(resolve => setImmediate(resolve));};
}
function activateTemplate(f: Awaited<ReturnType<typeof fixture>>) {
  f.$('template').blur(); f.$('template').focus();
}

test('typing announces suggestions without sending; keyboard focus starts inference without a delay', async t => {
  const f = await fixture({suggestions: true});
  const tick = suggestionClock(t, f);
  try {
    f.$('template').value = 'simple';
    f.$('description').focus(); f.input('description', 'First description');
    assert.equal(f.$('template-suggestion').hidden, false);
    assert.equal(f.$('suggestion-message').textContent, 'Suggesting a template…');
    assert.equal(f.$('suggestion-spinner').hidden, false);
    await tick(6000); assert.equal(f.count('/api/template-suggestion'), 0);
    f.input('description', '  A Julia package for few-body Schrödinger equations.  ');
    f.$('description').blur(); await tick(6000);
    assert.equal(f.count('/api/template-suggestion'), 0, 'Neither idle time nor description blur invokes Jev');
    const pending = deferred(); f.state.suggestionGate = pending;
    activateTemplate(f);
    assert.equal(f.count('/api/template-suggestion'), 1, 'Focus starts the request without advancing the clock');
    assert.deepEqual(f.calls.find(call => call.url === '/api/template-suggestion')!.body, {description: 'A Julia package for few-body Schrödinger equations.'});
    assert.equal(f.$('suggestion-message').textContent, 'Suggesting a template…');
    pending.resolve({template: 'minimum', probabilities: {minimum: 0.8, simple: 0.15, 'all-in-one': 0.05}});
    await tick(0);
    assert.equal(f.$('template-suggestion').textContent, 'Jev recommends Minimum. (minimum: 80%, simple: 15%, all-in-one: 5%)');
    assert.equal(f.$('template-suggestion').hidden, false);
    assert.equal(f.$('suggestion-spinner').hidden, true);
    assert.equal(f.$('template').value, 'simple');
    assert.deepEqual(f.scrolls, []);
    f.input('description', '   '); activateTemplate(f); await tick(6000);
    assert.equal(f.count('/api/template-suggestion'), 1); assert.equal(f.$('template-suggestion').hidden, true);
    assert.equal(f.$('suggestion-spinner').hidden, true);
  } finally {f.close();}
});

test('mouse and touch presses request a suggestion before focus or option hover, without duplicate requests', async t => {
  const f = await fixture({suggestions: true});
  const tick = suggestionClock(t, f);
  try {
    let requests = 0;
    for (const pointerType of ['mouse', 'touch']) {
      f.$('description').focus(); f.input('description', `A ${pointerType} test package`);
      const pending = deferred(); f.state.suggestionGate = pending;
      const press = (button = 0, isPrimary = true) => new f.w.PointerEvent('pointerdown', {bubbles: true, cancelable: true, pointerType, button, isPrimary});
      f.$('template').dispatchEvent(new f.w.PointerEvent('pointerover', {bubbles: true, pointerType}));
      f.$('template').dispatchEvent(press(2));
      f.$('template').dispatchEvent(press(0, false));
      assert.equal(f.count('/api/template-suggestion'), requests, 'Hover and non-primary presses do not start inference');
      const event = press();
      assert.equal(f.$('template').dispatchEvent(event), true);
      assert.equal(event.defaultPrevented, false, 'The native picker can still open');
      assert.equal(f.count('/api/template-suggestion'), ++requests, 'The request starts on press, before focus or release');
      assert.equal(f.w.document.activeElement.id, 'description', 'No focus event was needed');
      assert.equal(f.$('suggestion-message').textContent, 'Suggesting a template…');
      f.$('template').focus();
      f.$('template').dispatchEvent(new f.w.PointerEvent('pointerup', {bubbles: true, pointerType}));
      f.$('template').click();
      assert.equal(f.count('/api/template-suggestion'), requests);
      pending.resolve(suggested); await tick(0);
      assert.equal(f.$('suggestion-message').textContent, suggestionMessage, 'The result appears without option hover');
      assert.equal(f.$('template').value, '');
      f.$('template').dispatchEvent(press()); await tick(0);
      assert.equal(f.count('/api/template-suggestion'), requests, 'Another press reuses the completed result');
    }
  } finally {f.close();}
});

test('pressing an already focused dropdown retries a failed suggestion', async t => {
  const f = await fixture({suggestions: true});
  const tick = suggestionClock(t, f);
  try {
    f.input('description', 'Retry without leaving the dropdown');
    f.state.suggestionFailure = true; activateTemplate(f); await tick(0);
    assert.equal(f.count('/api/template-suggestion'), 1);
    assert.match(f.$('suggestion-message').textContent, /unavailable/);
    assert.equal(f.w.document.activeElement.id, 'template');
    f.state.suggestionFailure = false;
    f.$('template').dispatchEvent(new f.w.PointerEvent('pointerdown', {bubbles: true, button: 0, isPrimary: true, pointerType: 'mouse'}));
    assert.equal(f.count('/api/template-suggestion'), 2);
    await tick(0); assert.equal(f.$('suggestion-message').textContent, suggestionMessage);
  } finally {f.close();}
});

test('refocusing reuses pending and completed suggestions until the description changes', async t => {
  const f = await fixture({suggestions: true});
  const tick = suggestionClock(t, f);
  try {
    const pending = deferred(); f.state.suggestionGate = pending;
    f.input('description', 'Original description'); activateTemplate(f);
    activateTemplate(f); activateTemplate(f); await tick(0);
    assert.equal(f.count('/api/template-suggestion'), 1);
    assert.equal(f.calls.find(call => call.url === '/api/template-suggestion')!.signal!.aborted, false);
    pending.resolve(suggested); await tick(0);
    activateTemplate(f); activateTemplate(f); await tick(0);
    assert.equal(f.count('/api/template-suggestion'), 1);
    assert.equal(f.$('template-suggestion').textContent, suggestionMessage);
    f.input('description', 'Edited description'); await tick(6000);
    assert.equal(f.count('/api/template-suggestion'), 1);
    assert.equal(f.$('suggestion-message').textContent, 'Suggesting a template…');
    f.state.suggestionGate = undefined; activateTemplate(f); await tick(0);
    assert.equal(f.count('/api/template-suggestion'), 2);
  } finally {f.close();}
});

test('suggestions discard stale responses and reset cancels pending work', async t => {
  const f = await fixture({suggestions: true});
  const tick = suggestionClock(t, f);
  try {
    const old = deferred(); f.state.suggestionGate = old;
    f.input('description', 'Old description'); activateTemplate(f); await tick(0);
    assert.equal(f.$('suggestion-spinner').hidden, false);
    const request = f.calls.find(call => call.url === '/api/template-suggestion')!;
    f.input('description', 'New description'); assert.equal(request.signal!.aborted, true);
    f.state.suggestionGate = undefined; await tick(6000);
    assert.equal(f.count('/api/template-suggestion'), 1);
    activateTemplate(f); await tick(0);
    old.resolve({template: 'minimum', probabilities: {minimum: 1, simple: 0, 'all-in-one': 0}}); await tick(0);
    assert.equal(f.$('template-suggestion').textContent, suggestionMessage);
    assert.equal(f.$('suggestion-spinner').hidden, true);
    assert.equal(f.$('template').value, '');
    const reset = deferred(); f.state.suggestionGate = reset;
    f.input('description', 'Before reset'); activateTemplate(f); await tick(0);
    f.$('package-form').reset(); reset.resolve(suggested); await tick(0);
    assert.equal(f.$('template-suggestion').hidden, true);
    assert.equal(f.$('suggestion-spinner').hidden, true);
    f.input('description', 'Not yet requested'); f.$('package-form').reset(); activateTemplate(f); await tick(6000);
    assert.equal(f.count('/api/template-suggestion'), 3);
  } finally {f.close();}
});

test('IME input waits for commitment and template focus; refocusing retries a failed suggestion', async t => {
  const f = await fixture({suggestions: true});
  const tick = suggestionClock(t, f);
  try {
    f.input('description', 'Pending edit');
    f.$('description').dispatchEvent(new f.w.CompositionEvent('compositionstart', {bubbles: true}));
    f.input('description', '数値計算'); activateTemplate(f); await tick(6000);
    assert.equal(f.count('/api/template-suggestion'), 0);
    assert.equal(f.$('suggestion-spinner').hidden, false);
    f.$('description').focus();
    f.$('description').dispatchEvent(new f.w.CompositionEvent('compositionend', {bubbles: true}));
    await tick(6000); assert.equal(f.count('/api/template-suggestion'), 0);
    f.state.suggestionFailure = true; activateTemplate(f); await tick(0);
    assert.match(f.$('template-suggestion').textContent, /unavailable/);
    assert.equal(f.$('suggestion-spinner').hidden, true);
    assert.equal(f.$('template').disabled, false); assert.equal(f.$('package-fields').disabled, false);
    f.state.suggestionFailure = false; activateTemplate(f); await tick(0);
    assert.equal(f.count('/api/template-suggestion'), 2);
    assert.equal(f.$('template-suggestion').textContent, suggestionMessage);
  } finally {f.close();}
});

test('composition ending after template focus starts exactly one suggestion for committed text', async t => {
  const f = await fixture({suggestions: true});
  const tick = suggestionClock(t, f);
  try {
    f.$('description').dispatchEvent(new f.w.CompositionEvent('compositionstart', {bubbles: true}));
    f.input('description', '量子力学'); activateTemplate(f);
    assert.equal(f.count('/api/template-suggestion'), 0);
    f.$('description').dispatchEvent(new f.w.CompositionEvent('compositionend', {bubbles: true}));
    assert.equal(f.count('/api/template-suggestion'), 1);
    await tick(0); assert.equal(f.$('template-suggestion').textContent, suggestionMessage);
  } finally {f.close();}
});

test('local pages without Workers AI never request a suggestion', async t => {
  const f = await fixture();
  const tick = suggestionClock(t, f);
  try {
    f.input('description', 'Small utility'); activateTemplate(f); await tick(6000);
    assert.equal(f.count('/api/template-suggestion'), 0); assert.equal(f.$('template-suggestion').hidden, true);
    assert.equal(f.$('suggestion-spinner').hidden, true);
  } finally {f.close();}
});

test('suggestion failures retain the API diagnostic and stop the spinner', async t => {
  const f = await fixture({suggestions: true});
  const tick = suggestionClock(t, f);
  try {
    f.state.suggestionApiError = 'Jev request failed (HTTP 403). You can choose a template below.';
    f.input('description', 'Scientific computing');
    assert.equal(f.$('suggestion-spinner').hidden, false);
    activateTemplate(f); await tick(0);
    assert.equal(f.$('template-suggestion').textContent, f.state.suggestionApiError);
    assert.equal(f.$('suggestion-spinner').hidden, true);
    assert.equal(f.$('template').disabled, false);
    assert.equal(f.$('package-fields').disabled, false);
  } finally {f.close();}
});

test('suggestion timeout stops loading, refocusing retries, and late responses are ignored', async t => {
  const f = await fixture({suggestions: true});
  const tick = suggestionClock(t, f);
  try {
    const pending = deferred(); f.state.suggestionGate = pending;
    f.input('description', 'Slow request'); activateTemplate(f); await tick(0);
    assert.equal(f.$('suggestion-spinner').hidden, false);
    await tick(15000);
    assert.equal(f.$('suggestion-spinner').hidden, true);
    assert.match(f.$('suggestion-message').textContent, /timed out/);
    f.state.suggestionGate = undefined; activateTemplate(f); await tick(0);
    assert.equal(f.count('/api/template-suggestion'), 2);
    assert.equal(f.$('template-suggestion').textContent, suggestionMessage);
    pending.resolve({template: 'minimum', probabilities: {minimum: 1, simple: 0, 'all-in-one': 0}}); await tick(0);
    assert.equal(f.$('template-suggestion').textContent, suggestionMessage);
    assert.equal(f.$('suggestion-spinner').hidden, true);
  } finally {f.close();}
});

test('an unrecognized suggestion stops loading without changing the template', async t => {
  const f = await fixture({suggestions: true});
  const tick = suggestionClock(t, f);
  try {
    const pending = deferred(); f.state.suggestionGate = pending;
    f.input('description', 'Unexpected response'); activateTemplate(f); await tick(0);
    pending.resolve({template: '<script>invalid</script>', probabilities: suggested.probabilities}); await tick(0);
    assert.equal(f.$('suggestion-spinner').hidden, true);
    assert.match(f.$('suggestion-message').textContent, /not recognized/);
    assert.doesNotMatch(f.$('suggestion-message').textContent, /script/);
    assert.equal(f.$('template').value, '');
  } finally {f.close();}
});

test('probabilities use fixed option order and whole percentages, including zero', async t => {
  const f = await fixture({suggestions: true});
  const tick = suggestionClock(t, f);
  try {
    for (const [probabilities, expected] of [
      [{'all-in-one': 0, simple: 0, minimum: 1}, 'minimum: 100%, simple: 0%, all-in-one: 0%'],
      [{'all-in-one': 0.001, simple: 0.333, minimum: 0.666}, 'minimum: 67%, simple: 33%, all-in-one: 0%'],
    ] as const) {
      const pending = deferred(); f.state.suggestionGate = pending;
      f.input('description', expected); activateTemplate(f);
      pending.resolve({template: 'minimum', probabilities}); await tick(0);
      assert.equal(f.$('template-suggestion').textContent, `Jev recommends Minimum. (${expected})`);
    }
    const pending = deferred(); f.state.suggestionGate = pending;
    f.input('description', 'Missing probabilities'); activateTemplate(f);
    pending.resolve({template: 'minimum'}); await tick(0);
    assert.match(f.$('suggestion-message').textContent, /probabilities were not recognized/);
    assert.doesNotMatch(f.$('suggestion-message').textContent, /NaN|undefined/);
    assert.equal(f.$('suggestion-spinner').hidden, true);
  } finally {f.close();}
});

test('suggestions stop after ten requests, survive form resets, and resume on a fresh page', async t => {
  const f = await fixture({suggestions: true});
  const tick = suggestionClock(t, f);
  try {
    f.input('description', '   '); activateTemplate(f); await tick(0);
    f.input('description', 'x'.repeat(2001)); activateTemplate(f); await tick(0);
    f.input('description', 'Not submitted'); await tick(6000);
    assert.equal(f.count('/api/template-suggestion'), 0);
    for (let i = 1; i <= 10; i++) {
      f.input('description', `Package ${i}`); activateTemplate(f); await tick(0);
      assert.equal(f.count('/api/template-suggestion'), i);
      assert.equal(f.$('template-suggestion').textContent, suggestionMessage);
    }
    activateTemplate(f); await tick(0);
    assert.equal(f.count('/api/template-suggestion'), 10);
    assert.equal(f.$('template-suggestion').textContent, suggestionMessage, 'The tenth result stays visible on refocus');
    f.input('description', 'Eleventh request'); activateTemplate(f); await tick(0);
    f.$('template').dispatchEvent(new f.w.PointerEvent('pointerdown', {bubbles: true, button: 0, isPrimary: true, pointerType: 'mouse'}));
    assert.equal(f.count('/api/template-suggestion'), 10);
    assert.match(f.$('template-suggestion').textContent, /limit reached \(10 requests\).*Reload/);
    assert.equal(f.$('template-suggestion').hidden, false);
    assert.equal(f.$('suggestion-spinner').hidden, true);
    f.$('package-form').reset();
    f.input('description', 'After reset'); activateTemplate(f); await tick(0);
    assert.equal(f.count('/api/template-suggestion'), 10);
    assert.match(f.$('template-suggestion').textContent, /limit reached/);
    assert.equal(f.$('template').disabled, false); assert.equal(f.$('package-fields').disabled, false);
    f.select('template', 'minimum'); assert.equal(f.$('template').value, 'minimum');
  } finally {f.close(); t.mock.timers.reset();}

  // A new document runs the same bundle again, as a reload does.
  const reloaded = await fixture({suggestions: true});
  const reloadTick = suggestionClock(t, reloaded);
  try {
    reloaded.input('description', 'After reload'); activateTemplate(reloaded); await reloadTick(0);
    assert.equal(reloaded.count('/api/template-suggestion'), 1);
    assert.equal(reloaded.$('template-suggestion').textContent, suggestionMessage);
  } finally {reloaded.close();}
});

test('failed and aborted suggestion requests consume the page budget', async t => {
  const f = await fixture({suggestions: true});
  const tick = suggestionClock(t, f);
  try {
    f.state.suggestionFailure = true;
    f.input('description', 'Failed request'); activateTemplate(f); await tick(0);
    assert.match(f.$('template-suggestion').textContent, /unavailable/);
    f.state.suggestionFailure = false;
    for (let i = 2; i < 10; i++) {
      f.input('description', `Package ${i}`); activateTemplate(f); await tick(0);
    }
    const pending = deferred(); f.state.suggestionGate = pending;
    f.input('description', 'Pending tenth request'); activateTemplate(f); await tick(0);
    const request = f.calls.filter(call => call.url === '/api/template-suggestion').at(-1)!;
    f.input('description', 'Abort tenth request');
    assert.equal(request.signal!.aborted, true);
    pending.resolve(suggested); activateTemplate(f); await tick(0);
    assert.equal(f.count('/api/template-suggestion'), 10);
    assert.match(f.$('template-suggestion').textContent, /limit reached/);
    assert.equal(f.$('template').value, '');
  } finally {f.close();}
});

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
    assert.equal(f.badge(4), 'Checking'); gate.resolve(); f.state.appsGate = undefined;
    await wait(() => $('codecov-state').textContent === 'Check on GitHub');
    assert.equal(f.badge(4), 'Ready'); assert.equal(f.badge(5), 'Upcoming');
    $('codecov-confirmed').click(); await wait(ready);
    assert.equal(f.badge(4), 'Completed'); assert.equal($('tagbot-state').textContent, 'Automatic'); assert.deepEqual(f.scrolls, ['4']);
    select('visibility', 'public'); assert.equal($('private-docs-help').hidden, true);
    await wait(ready); $('confirm').click(); const previews = f.count('/api/preview');
    const refreshGate = deferred(); f.state.appsGate = refreshGate; f.state.app = {state: 'installed', selection: 'selected'};
    $('codecov-link').click(); w.dispatchEvent(new w.Event('focus')); w.document.dispatchEvent(new w.Event('visibilitychange'));
    assert.equal(f.badge(4), 'Checking'); assert.equal(f.count('/api/github/apps'), 2);
    refreshGate.resolve(); f.state.appsGate = undefined; await wait(() => $('codecov-state').textContent === 'Installed');
    assert.equal(f.count('/api/preview'), previews); assert.equal($('confirm').checked, true);
    f.state.appsFailure = true; $('codecov-link').click(); w.dispatchEvent(new w.Event('focus'));
    await wait(() => !$('codecov-confirmation').hidden); assert.match($('codecov-detail').textContent, /Confirmed by you/);
    $('codecov-confirmed').click(); assert.equal($('codecov-state').textContent, 'Check on GitHub');
    assert.equal(f.badge(4), 'Ready'); assert.equal(f.badge(5), 'Upcoming'); assert.equal($('create').disabled, true);
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
    assert.equal(f.$('ai-handoff').hidden, true); assert.equal(f.badge(7), 'Upcoming');
    f.$('create').click(); assert.equal(f.count('/api/create'), 1);
  } finally {f.close();}
});

test('success preserves review and combines relevant next steps in one plain paragraph', async () => {
  const f = await fixture();
  try {
    f.state.app = {state: 'installed', selection: 'selected'};
    f.input('package-name', 'TestPackage'); f.select('template', 'simple'); await f.wait(f.ready);
    f.$('confirm').click(); f.$('create').click(); f.state.createGate.resolve({state: 'complete', repository: 'tester/TestPackage.jl'});
    await f.wait(() => !f.$('success-panel').hidden && f.$('documentation-link').textContent === 'view your documentation');
    assert.equal(f.$('preview').hidden, false); assert.equal(f.$('actions-link').href, 'https://github.com/tester/TestPackage.jl/actions');
    assert.equal(f.$('documentation-link').href, 'https://docs.example.test/'); assert.equal(f.$('codecov-followup').hidden, false);
    assert.equal(f.$('next-steps').tagName, 'P');
    assert.equal(f.$('next-steps').querySelector('section, h3, button, .button, .success-actions'), null);
    assert.equal(f.$('next-steps').textContent, 'Follow the builds in GitHub Actions and view your documentation. Ensure Codecov can access this repository. If you wish to register your package in Julia’s General registry, a separate registration process is required.');
    assert.equal(f.scrolls.at(-1), '6');
    const completedReview = f.$('review-status').textContent;
    f.state.appsFailure = true; f.$('codecov-followup').querySelector('a').click(); f.w.dispatchEvent(new f.w.Event('focus'));
    await f.wait(() => f.$('codecov-state').textContent === 'Check on GitHub');
    assert.equal(f.badge(4), 'Completed'); assert.equal(f.badge(5), 'Completed');
    assert.equal(f.$('review-status').textContent, completedReview);
    f.state.appsFailure = false; f.state.app = {state: 'installed', selection: 'all'};
    f.$('codecov-followup').querySelector('a').click(); f.w.dispatchEvent(new f.w.Event('focus'));
    await f.wait(() => f.$('codecov-followup').hidden);
    assert.equal(f.badge(4), 'Completed'); assert.equal(f.badge(5), 'Completed');
    f.$('create-another').click(); assert.equal(f.$('template').value, ''); assert.equal(f.$('success-panel').hidden, true);
  } finally {f.close();}
});

test('AI handoff uses the created repository, preserves language drafts, and encodes edited prompts', async () => {
  const f = await fixture({language: 'ja-JP'});
  try {
    const {$, w} = f;
    const language = (lang: string) => w.document.querySelector(`[data-prompt-language="${lang}"]`).click();
    assert.equal($('ai-handoff').hidden, true); assert.equal($('copy-prompt').disabled, true);
    assert.equal($('open-chatgpt').hasAttribute('href'), false); assert.equal($('open-codex').hasAttribute('href'), false);
    f.input('package-name', 'TestPackage'); f.select('template', 'minimum'); await f.wait(f.ready);
    $('confirm').click(); $('create').click();
    f.state.createGate.resolve({state: 'complete', repository: 'Tester/TestPackage.jl'});
    await f.wait(() => !$('ai-handoff').hidden && !$('create-another').disabled);
    assert.equal($('ai-handoff-placeholder').hidden, true);
    assert.equal(f.badge(6), 'Ready'); assert.equal(f.badge(7), 'Ready');
    assert.equal(w.document.querySelectorAll('[aria-current="step"]').length, 1);
    assert.equal(w.document.querySelector('[aria-current="step"]').dataset.step, '6');
    const japanese = $('ai-prompt').value;
    assert.match(japanese, /私へのヒアリング/); assert.match(japanese, /合意した内容を実装・検証/);
    assert.equal(japanese.split('\n')[1], 'https://github.com/Tester/TestPackage.jl');
    assert.equal($('ai-prompt').lang, 'ja');
    const edited = japanese + '\n日本語 & a+b? #tag <example> "quotes"';
    const requests = f.calls.length;
    f.input('ai-prompt', edited); language('en');
    assert.match($('ai-prompt').value, /^Interview me/); assert.equal($('ai-prompt').lang, 'en');
    f.input('ai-prompt', 'Custom English prompt'); language('ja');
    assert.equal($('ai-prompt').value, edited);
    assert.equal(w.document.querySelector('[data-prompt-language="ja"]').getAttribute('aria-pressed'), 'true');
    assert.equal(new URL($('open-chatgpt').href).searchParams.get('q'), edited);
    const codex = new URL($('open-codex').href);
    assert.equal(codex.protocol, 'codex:'); assert.equal(codex.hostname, 'new');
    assert.equal(codex.searchParams.get('prompt'), edited);
    assert.equal(codex.searchParams.get('originUrl'), 'https://github.com/Tester/TestPackage.jl.git');
    assert.equal($('open-claude').href, 'https://claude.ai/');
    let copied = '';
    Object.defineProperty(w.navigator, 'clipboard', {value: {writeText: async (text: string) => {copied = text;}}});
    $('copy-prompt').click(); await f.wait(() => $('prompt-copy-status').textContent.startsWith('Copied'));
    assert.equal(copied, edited);
    language('en'); assert.equal($('ai-prompt').value, 'Custom English prompt');
    assert.equal($('prompt-copy-status').textContent, '');
    f.input('ai-prompt', ' \n');
    assert.equal($('copy-prompt').disabled, true);
    for (const id of ['open-chatgpt', 'open-codex']) {
      assert.equal($(id).hasAttribute('href'), false); assert.equal($(id).getAttribute('aria-disabled'), 'true');
    }
    assert.equal(f.calls.length, requests, 'Editing and copying never send the prompt to the server');
    $('create-another').click();
    assert.equal($('ai-handoff').hidden, true); assert.equal($('ai-prompt').value, '');
    assert.equal(f.badge(7), 'Upcoming');
    f.state.createGate = deferred();
    f.input('package-name', 'AnotherPackage'); f.select('template', 'minimum'); await f.wait(f.ready);
    $('confirm').click(); $('create').click(); f.state.createGate.resolve({state: 'complete', repository: 'tester/AnotherPackage.jl'});
    await f.wait(() => !$('ai-handoff').hidden && !$('create-another').disabled);
    for (const lang of ['en', 'ja']) {
      language(lang);
      assert.match($('ai-prompt').value, /https:\/\/github.com\/tester\/AnotherPackage.jl$/);
      assert.doesNotMatch($('ai-prompt').value, /TestPackage|Custom English|#tag/);
    }
  } finally {f.close();}
});

test('AI prompt copying falls back to selection and ignores stale clipboard completions', async () => {
  const f = await fixture();
  try {
    const {$, w} = f;
    f.input('package-name', 'TestPackage'); f.select('template', 'minimum'); await f.wait(f.ready);
    $('confirm').click(); $('create').click(); f.state.createGate.resolve({state: 'complete', repository: 'tester/TestPackage.jl'});
    await f.wait(() => !$('ai-handoff').hidden && !$('create-another').disabled);
    for (const clipboard of [undefined, {writeText: async () => {throw Error('Permission denied');}}]) {
      Object.defineProperty(w.navigator, 'clipboard', {configurable: true, value: clipboard});
      f.input('ai-prompt', 'Copy this prompt'); $('copy-prompt').click();
      await f.wait(() => $('prompt-copy-status').textContent.startsWith('Text selected'));
      assert.equal(w.document.activeElement.id, 'ai-prompt');
      assert.equal($('ai-prompt').selectionStart, 0); assert.equal($('ai-prompt').selectionEnd, $('ai-prompt').value.length);
    }
    const pending = deferred();
    Object.defineProperty(w.navigator, 'clipboard', {configurable: true, value: {writeText: () => pending.promise}});
    $('copy-prompt').click(); $('create-another').click(); pending.resolve();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal($('prompt-copy-status').textContent, '');
    assert.equal(w.document.activeElement.id, 'package-name');
  } finally {f.close();}
});

for (const template of ['simple', 'all-in-one']) test(`${template} waits for Codecov confirmation and invalidates review when it is removed`, async () => {
  const f = await fixture();
  try {
    f.input('package-name', 'TestPackage'); f.select('template', template);
    await f.wait(() => f.$('package-availability').classList.contains('is-available') && f.$('codecov-state').textContent === 'Check on GitHub');
    await delay(500);
    assert.equal(f.badge(4), 'Ready'); assert.equal(f.badge(5), 'Upcoming'); assert.equal(f.count('/api/preview'), 0);
    assert.equal(f.$('preview').hidden, true); assert.match(f.$('review-status').textContent, /Confirm Codecov/);
    f.$('codecov-confirmed').click(); await f.wait(f.ready);
    assert.equal(f.badge(4), 'Completed'); assert.equal(f.badge(5), 'Ready');
    f.$('confirm').click(); assert.equal(f.$('create').disabled, false);
    f.$('codecov-confirmed').click();
    assert.equal(f.badge(4), 'Ready'); assert.equal(f.badge(5), 'Upcoming');
    assert.equal(f.$('preview').hidden, true); assert.equal(f.$('confirm').checked, false); assert.equal(f.$('create').disabled, true);
    f.$('codecov-confirmed').click(); await f.wait(f.ready);
    f.select('owner', 'ExampleOrg');
    await f.wait(() => f.$('package-availability').classList.contains('is-available') && f.$('codecov-detail').textContent.includes('@ExampleOrg') && !f.$('codecov-confirmation').hidden);
    assert.equal(f.$('codecov-confirmed').checked, false); assert.equal(f.badge(4), 'Ready'); assert.equal(f.badge(5), 'Upcoming');
    f.select('template', 'minimum'); await f.wait(f.ready); assert.equal(f.badge(4), 'Completed');
  } finally {f.close();}
});

test('known missing or suspended Codecov installations cannot complete automation', async () => {
  for (const state of ['not-installed', 'suspended']) {
    const f = await fixture();
    try {
      f.state.app = {state, selection: undefined}; f.input('package-name', 'TestPackage'); f.select('template', 'simple');
      await f.wait(() => f.$('package-availability').classList.contains('is-available') && f.$('codecov-state').textContent === (state === 'suspended' ? 'Suspended' : 'Not installed'));
      await delay(500);
      assert.equal(f.badge(4), 'Ready'); assert.equal(f.badge(5), 'Upcoming'); assert.equal(f.count('/api/preview'), 0);
      f.state.app = {state: 'installed', selection: 'all'}; f.$('codecov-link').click(); f.w.dispatchEvent(new f.w.Event('focus'));
      await f.wait(f.ready); assert.equal(f.badge(4), 'Completed'); assert.equal(f.$('codecov-confirmation').hidden, true);
    } finally {f.close();}
  }
});

test('a private Minimum package has only the relevant Actions sentence after creation', async () => {
  const f = await fixture();
  try {
    f.input('package-name', 'TestPackage'); f.select('template', 'minimum'); f.select('visibility', 'private'); await f.wait(f.ready);
    f.$('confirm').click(); f.$('create').click(); f.state.createGate.resolve({state: 'complete', repository: 'tester/TestPackage.jl'});
    await f.wait(() => !f.$('success-panel').hidden);
    for (const id of ['documentation-followup', 'codecov-followup', 'registration-guide']) assert.equal(f.$(id).hidden, true);
    const visible = f.$('next-steps').cloneNode(true); for (const hidden of visible.querySelectorAll('[hidden]')) hidden.remove();
    assert.equal(visible.textContent, 'Follow the builds in GitHub Actions.');
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
