import { appSlugs, unknownInstallations, type AppInstallations } from '../github/apps.js';
import { normalizeAuthorSeparators, parseAuthors, workflowStates } from './workflow.js';
import { packageNameError } from '../core/package-name.js';

const element = <T = HTMLElement>(id: string) => document.getElementById(id) as T;
const form = element<HTMLFormElement>('package-form');
const fields = element<HTMLFieldSetElement>('package-fields');
const output = element<HTMLOutputElement>('result');
const owner = element<HTMLSelectElement>('owner');
const name = element<HTMLInputElement>('package-name');
const authors = element<HTMLTextAreaElement>('authors');
const description = element<HTMLTextAreaElement>('description');
const template = element<HTMLSelectElement>('template');
const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')!.content;
const cards = [...document.querySelectorAll<HTMLElement>('.workflow-card[data-step]')];
const displayedApps = appSlugs.filter(slug => document.getElementById(`${slug}-row`));
let profileReady = false, working = false, available = false, previewReady = false, created = false;
let planId = '', checkedAppsOwner = '', composing = false;
let previewKey = '', previewRevision = 0, previewInFlight = false, previewPending = false, previewFailed = false, previewPreparedAt = 0;
let previewTimer: ReturnType<typeof setTimeout> | undefined, previewExpiry: ReturnType<typeof setTimeout> | undefined;
let creationTimer: ReturnType<typeof setInterval> | undefined;
let availabilityRevision = 0, availabilityTimer: ReturnType<typeof setTimeout> | undefined, availabilityAbort: AbortController | undefined;
let appsRevision = 0, appsAbort: AbortController | undefined, appsLoading = false;
let suggestionRevision = 0, suggestionTimer: ReturnType<typeof setTimeout> | undefined, suggestionAbort: AbortController | undefined;
const suggestionLimit = 10;
// Page lifetime only: resets and aborted/failed requests do not replenish the budget.
let suggestionRequests = 0;
let descriptionComposing = false;
let installations: AppInstallations = unknownInstallations();
const confirmedApps = new Map<string, Set<string>>();
let defaultAuthor = '';
let profileLogin = '', authRequired = false, authorsTouched = false, advancedToAutomation = false;
let creating = false, creationFailed = false, appReturnPending = false;
let selectedFile = '', fileScroll = 0, contentScroll = {top: 0, left: 0};
const draftKey = 'pkgfactory-reconnect-settings';
const hasAutomation = () => !!template.value && template.value !== 'minimum';
function appConfirmed(slug: typeof displayedApps[number]) {
  return installations[slug].state === 'installed'
    || (installations[slug].state === 'unknown' && confirmedApps.get(owner.value)?.has(slug) === true);
}

async function call(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(path, {method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: body === undefined ? {} : {'Content-Type': 'application/json', 'X-PkgFactory-CSRF': csrf},
    body: body === undefined ? undefined : JSON.stringify(body), signal});
  const data = await response.json() as any;
  if (response.status === 401 || data.code === 'auth' || data.code === 'identity') {
    authRequired = true; element('reconnect-notice').hidden = false; controls();
  }
  if (!response.ok || data.error) throw new Error(data.code === 'exists' ? 'This repository already exists. Choose a different package name.' : data.error || 'Request failed');
  return data;
}
function validAuthors() {
  const values = parseAuthors(authors.value);
  const error = !values.length ? 'Enter at least one author.' : values.length > 20 ? 'Enter at most 20 authors.'
    : values.some(author => author.length > 200) ? 'Use at most 200 characters per author.'
    : values.some(author => /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(author)) ? 'Remove control characters from author names.' : '';
  authors.setCustomValidity(error);
  const showError = (authorsTouched || !!authors.value) && !composing && !!error;
  authors.setAttribute('aria-invalid', String(showError));
  element('authors-error').hidden = !showError; element('authors-error').textContent = showError ? error : '';
  return !error;
}
function controls() {
  if (authRequired || working || created) clearSuggestion();
  const metadataReady = validAuthors();
  const settingsReady = profileReady && !authRequired && available && !!template.value && metadataReady;
  const appsConfirmed = !hasAutomation() || (checkedAppsOwner === owner.value && displayedApps.every(appConfirmed));
  const automationReady = settingsReady && (created || (appsConfirmed && !appsLoading));
  synchronizePreview(settingsReady && appsConfirmed && !composing);
  if (!created && settingsReady && !appsConfirmed && !appsLoading) element('review-status').textContent = 'Confirm Codecov in Configure automation to prepare your review.';
  const states = workflowStates([profileReady && !authRequired, available, !!template.value && metadataReady, automationReady, created, false]);
  for (const [index, card] of cards.entries()) {
    const state = states[index];
    const activity = index === 3 && !created && settingsReady && appsLoading && hasAutomation() ? 'Checking'
      : index === 4 && creating ? 'Creating' : index === 4 && creationFailed ? 'Needs attention'
      : index === 4 && previewPending ? 'Preparing' : index === 4 && previewFailed ? 'Needs attention' : '';
    card.classList.toggle('is-complete', state === 'complete' && !activity);
    card.classList.toggle('is-active', state === 'ready');
    card.classList.toggle('is-busy', !!activity && activity !== 'Needs attention');
    card.classList.toggle('has-error', activity === 'Needs attention');
    if (state === 'ready') card.setAttribute('aria-current', 'step'); else card.removeAttribute('aria-current');
    const label = card.querySelector<HTMLElement>('.step-state')!;
    const text = activity || (state === 'complete' ? 'Completed' : state === 'ready' ? 'Ready' : 'Upcoming');
    if (label.textContent !== text) label.textContent = text;
  }
  fields.disabled = working || created;
  element('review-spinner').hidden = !previewPending;
  element('review-content').setAttribute('aria-busy', String(previewPending));
  element<HTMLButtonElement>('retry-preview').hidden = !previewFailed;
  element<HTMLButtonElement>('retry-preview').disabled = working || created;
  element<HTMLButtonElement>('create').disabled = working || created || creationFailed || !automationReady || !previewReady || !element<HTMLInputElement>('confirm').checked;
  element<HTMLInputElement>('confirm').disabled = working || created || !previewReady;
  element('success-placeholder').hidden = created;
  element('success-panel').hidden = !created;
  for (const id of ['logout', 'retry-profile', 'create-another']) {const button = document.getElementById(id) as HTMLButtonElement | null; if (button) button.disabled = working;}
  if (settingsReady) advanceToAutomation();
}
function advanceToAutomation(fromTemplate = false) {
  if (advancedToAutomation || composing || working || created || authRequired || !profileReady || !available || !template.value || !validAuthors()) return;
  const active = document.activeElement as HTMLElement | null;
  const step = Number(active?.closest<HTMLElement>('[data-step]')?.dataset.step);
  if (step >= 4) {advancedToAutomation = true; return;}
  // Wait until text entry ends; never interrupt typing or jump past automation.
  if (!fromTemplate && active?.matches('input, textarea, select')) return;
  advancedToAutomation = true; focusStep(4);
}
async function busy(fn: () => Promise<void>) {
  if (working) return;
  working = true; controls(); output.textContent = 'Working…';
  try {await fn();} catch (error) {output.textContent = (error as Error).message;}
  finally {working = false; controls();}
}
function synchronizePreview(ready: boolean) {
  if (working || created) return;
  const key = ready ? JSON.stringify({owner: owner.value, name: name.value, authors: parseAuthors(authors.value),
    description: element<HTMLTextAreaElement>('description').value, template: template.value, visibility: element<HTMLSelectElement>('visibility').value}) : '';
  if (key === previewKey) return;
  if (!element('preview').hidden) {
    fileScroll = element('files').scrollTop;
    contentScroll = {top: element('content').scrollTop, left: element('content').scrollLeft};
  }
  previewKey = key; previewRevision++; previewReady = false; previewFailed = false; previewPending = !!key;
  creationFailed = false;
  clearTimeout(previewTimer); clearTimeout(previewExpiry);
  element('preview').hidden = true; element<HTMLInputElement>('confirm').checked = false; output.textContent = '';
  element('creation-error').hidden = true;
  element('creation-recovery').hidden = true;
  element('review-status').textContent = key ? 'Preparing your review…' : 'Complete the package settings to prepare your review automatically.';
  if (key) queuePreview();
}
function queuePreview() {
  clearTimeout(previewTimer);
  const revision = previewRevision;
  previewTimer = setTimeout(() => {void preparePreview(revision);}, 450);
}
function availability(message: string, state = 'checking') {
  available = state === 'available';
  const notice = element('package-availability'); notice.textContent = message; notice.className = `availability-status is-${state}`;
  name.setAttribute('aria-invalid', String(state === 'unavailable' && !!name.value));
  controls();
}
async function checkAvailability(revision: number) {
  if (!profileReady || authRequired || packageNameError(name.value)) return;
  const controller = new AbortController(); availabilityAbort = controller;
  availability('Checking GitHub…');
  try {
    const result = await call('/api/github/availability', {owner: owner.value, name: name.value}, controller.signal);
    if (revision !== availabilityRevision) return;
    availability(result.available ? `${result.repository} is available. GitHub permissions are checked again when creating.` : `${result.repository} already exists. Choose a different package name.`, result.available ? 'available' : 'unavailable');
  } catch (error) {if (revision === availabilityRevision) availability((error as Error).message, 'unavailable');}
}
function scheduleAvailability() {
  clearTimeout(availabilityTimer); availabilityAbort?.abort();
  const revision = ++availabilityRevision;
  const error = packageNameError(name.value);
  name.setCustomValidity(error);
  if (error) {availability(name.value ? error : 'Enter a package name to check GitHub.', name.value ? 'unavailable' : 'checking'); return;}
  availability('Checking repository name…');
  availabilityTimer = setTimeout(() => {void checkAvailability(revision);}, 450);
}
function showSuggestion(message = '', loading = false) {
  element('suggestion-message').textContent = message;
  element('suggestion-spinner').hidden = !loading;
  element('template-suggestion').hidden = !message;
}
function clearSuggestion() {
  clearTimeout(suggestionTimer); suggestionRevision++; suggestionAbort?.abort();
  suggestionAbort = undefined;
  showSuggestion();
}
function scheduleSuggestion() {
  clearSuggestion();
  const query = description.value.trim();
  if (document.body.dataset.templateSuggestions !== 'true' || !profileReady || authRequired || working || created || !query || description.value.length > description.maxLength) return;
  if (suggestionRequests >= suggestionLimit) {
    showSuggestion(`Template suggestion limit reached (${suggestionLimit} requests). Reload the page for more suggestions, or choose a template below.`);
    return;
  }
  showSuggestion('テンプレートをサジェストします…', true);
  if (descriptionComposing) return;
  const revision = suggestionRevision;
  suggestionTimer = setTimeout(() => {void loadSuggestion(query, revision);}, 3000);
}
async function loadSuggestion(query: string, revision: number) {
  if (revision !== suggestionRevision || suggestionRequests >= suggestionLimit) return;
  suggestionRequests++;
  const controller = new AbortController(); suggestionAbort = controller;
  const timeout = setTimeout(() => {
    controller.abort();
    if (revision === suggestionRevision) showSuggestion('Template suggestion timed out. You can choose a template below.');
  }, 15000);
  try {
    const result = await call('/api/template-suggestion', {description: query}, controller.signal);
    if (revision !== suggestionRevision || controller.signal.aborted) return;
    // Use the existing option label; the model never supplies HTML or changes the selection.
    const option = [...template.options].find(option => option.value && option.value === result.template);
    if (!option) throw new Error('The suggested template was not recognized. You can choose a template below.');
    showSuggestion(`Jev recommends ${option.textContent!.split(' · ')[0]}.`);
  } catch (error) {
    // API messages contain safe diagnostics; do not replace them with a generic failure.
    if (revision === suggestionRevision && !controller.signal.aborted) showSuggestion((error as Error).message || 'Template suggestion unavailable. You can choose a template below.');
  } finally {clearTimeout(timeout); if (suggestionAbort === controller) suggestionAbort = undefined;}
}
function renderApps() {
  const confirmed = confirmedApps.get(owner.value);
  for (const slug of displayedApps) {
    const excluded = slug === 'codecov' && template.value === 'minimum';
    const installation = installations[slug];
    const selfConfirmed = installation.state === 'unknown' && !!confirmed?.has(slug);
    const installed = appConfirmed(slug);
    const badge = element(`${slug}-state`);
    badge.className = excluded || (!!template.value && installed && !appsLoading) ? 'configured-pill' : 'app-state';
    badge.textContent = !template.value ? 'Choose a template' : excluded ? 'Not included' : appsLoading ? 'Checking…' : installed ? 'Installed' : installation.state === 'suspended' ? 'Suspended' : installation.state === 'not-installed' ? 'Not installed' : 'Check on GitHub';
    // A manual confirmation is explicitly labelled, scoped to the selected owner,
    // and never treated as evidence that the future repository has app access.
    element(`${slug}-confirmation`).hidden = !hasAutomation() || appsLoading || installation.state !== 'unknown';
    element(`${slug}-link`).hidden = !hasAutomation();
    element<HTMLInputElement>(`${slug}-confirmed`).checked = selfConfirmed;
    element(`${slug}-detail`).textContent = !template.value ? '' : excluded ? 'Coverage uploads are not included in the Minimum template.'
      : appsLoading ? `Checking apps for @${owner.value}…`
      : selfConfirmed ? `Confirmed by you for @${owner.value}. Check access for the new repository after creation.`
      : installation.state === 'installed' ? installation.selection === 'all' ? `Installed for all repositories owned by @${owner.value}.` : `Installed for selected repositories owned by @${owner.value}. Add the new repository after creation.`
      : installation.state === 'suspended' ? `Installation for @${owner.value} is suspended. Review it on GitHub.`
      : installation.state === 'not-installed' ? `Not installed for @${owner.value}. Install it on GitHub, then return here.`
      : `Check installation for @${owner.value} on GitHub, then confirm below.`;
  }
  element('apps-help').hidden = !hasAutomation();
  element('codecov-followup').hidden = !created || !hasAutomation() || (installations.codecov.state === 'installed' && installations.codecov.selection === 'all');
}
async function loadApps() {
  appsAbort?.abort();
  const revision = ++appsRevision;
  if (checkedAppsOwner !== owner.value) installations = unknownInstallations();
  if (!profileReady || authRequired || !hasAutomation()) {checkedAppsOwner = ''; appsLoading = false; renderApps(); controls(); return;}
  const controller = new AbortController(); appsAbort = controller;
  const timeout = setTimeout(() => controller.abort(), 8000);
  appsLoading = true; renderApps(); controls();
  try {
    const result = await call('/api/github/apps', {owner: owner.value}, controller.signal);
    if (revision === appsRevision) installations = result;
  } catch {
    // A failed refresh must not present an old installation result as current.
    if (revision === appsRevision) installations = unknownInstallations();
  }
  finally {clearTimeout(timeout); if (revision === appsRevision) {checkedAppsOwner = owner.value; appsLoading = false; renderApps(); controls();}}
}
async function loadProfile() {
  await busy(async () => {
    element('connect-error').hidden = true;
    try {
      const profile = await call('/api/github/profile');
      const previousOwner = owner.value;
      owner.replaceChildren(...profile.owners.map((item: {login: string; name: string; kind: string}) => {
        const option = document.createElement('option'); option.value = item.login;
        option.textContent = `${item.name} (@${item.login})${item.kind === 'organization' ? ' · organization owner' : ' · personal account'}`;
        return option;
      }));
      if ([...owner.options].some(o => o.value === previousOwner)) owner.value = previousOwner;
      defaultAuthor = normalizeAuthorSeparators(profile.user.name);
      profileLogin = profile.user.login;
      restoreSettings();
      if (!authors.value) authors.value = defaultAuthor;
      element('connect-status').textContent = `Connected as @${profile.user.login}.`;
      element('connect-actions').hidden = true;
      authRequired = false; element('reconnect-notice').hidden = true;
      profileReady = true; form.hidden = false; output.textContent = '';
      automation();
      scheduleAvailability(); void loadApps();
    } catch (error) {
      profileReady = false; form.hidden = true;
      element('connect-actions').hidden = false;
      element('connect-error').textContent = (error as Error).message; element('connect-error').hidden = false;
      element('connect-status').textContent = 'GitHub account lookup did not complete. Retry or connect again.';
      output.textContent = '';
    }
  });
}
function automation() {
  const minimum = template.value === 'minimum';
  const documentation = !!template.value && !minimum;
  const privateRepository = element<HTMLSelectElement>('visibility').value === 'private';
  element('documenter-state').textContent = documentation ? 'Automatic' : minimum ? 'Not included' : 'Choose a template';
  element('documenter-state').className = template.value ? 'configured-pill' : 'app-state';
  element('tagbot-state').textContent = documentation ? 'Automatic' : minimum ? 'Not included' : 'Choose a template';
  element('tagbot-state').className = template.value ? 'configured-pill' : 'app-state';
  element('tagbot-detail').textContent = documentation ? 'Creates tags and GitHub releases after versions are registered in Julia’s General registry.'
    : 'Select Simple or All-in-one to include release automation.';
  element('documenter-detail').textContent = documentation ? 'Deploy key and DOCUMENTER_KEY repository secret are configured during creation.'
    : 'Select Simple or All-in-one to include documentation deployment.';
  element('codecov-description').textContent = documentation ? 'Coverage reports and pull request checks. Uploads use GitHub OIDC; no upload token is required.'
    : 'Select Simple or All-in-one to include coverage uploads. The app can be configured at any time.';
  element('registration-guide').hidden = privateRepository;
  element('private-docs-help').hidden = !privateRepository || minimum;
  element('automation-description').textContent = !template.value ? 'Choose a template to see which automation will be configured.'
    : minimum ? 'Minimum includes package tests and CI. Documentation, coverage, and release workflows are not included.'
    : 'Documenter and TagBot are configured automatically.';
  renderApps();
}
function normalizeAuthors() {
  const normalized = normalizeAuthorSeparators(authors.value);
  if (normalized === authors.value) return;
  const {selectionStart, selectionEnd, selectionDirection} = authors;
  authors.value = normalized;
  authors.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
}
authors.addEventListener('input', event => {authorsTouched = true; if (!(event as InputEvent).isComposing) normalizeAuthors();});
authors.addEventListener('blur', () => {authorsTouched = true; controls();});
form.addEventListener('compositionstart', () => {composing = true; controls();});
form.addEventListener('compositionend', () => {composing = false; normalizeAuthors(); controls();});
form.addEventListener('input', controls);
description.addEventListener('input', scheduleSuggestion);
description.addEventListener('compositionstart', () => {descriptionComposing = true; scheduleSuggestion();});
description.addEventListener('compositionend', () => {descriptionComposing = false; scheduleSuggestion();});
form.addEventListener('reset', clearSuggestion);
form.addEventListener('focusout', () => {setTimeout(() => advanceToAutomation(), 0);});
owner.addEventListener('change', () => {scheduleAvailability(); void loadApps();});
name.addEventListener('input', scheduleAvailability);
template.addEventListener('change', () => {
  automation(); void loadApps(); controls(); advanceToAutomation(true);
});
element('visibility').addEventListener('change', automation);
element('confirm').addEventListener('input', event => {event.stopPropagation(); controls();});
for (const slug of displayedApps) element(`${slug}-confirmed`).addEventListener('input', () => {
  const confirmed = confirmedApps.get(owner.value) ?? new Set<string>();
  if (element<HTMLInputElement>(`${slug}-confirmed`).checked) confirmed.add(slug); else confirmed.delete(slug);
  confirmedApps.set(owner.value, confirmed); renderApps();
});
for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href="https://github.com/apps/codecov"]')) {
  link.addEventListener('click', () => {appReturnPending = true;});
}
// Refresh once on return from GitHub; focus and visibility events may both fire.
function refreshAfterGitHub() {
  if (!appReturnPending || document.visibilityState === 'hidden' || working || !profileReady || authRequired) return;
  appReturnPending = false; void loadApps();
}
window.addEventListener('focus', refreshAfterGitHub);
document.addEventListener('visibilitychange', refreshAfterGitHub);
function focusStep(step: number) {
  const heading = cards[step - 1].querySelector<HTMLElement>('h2')!;
  heading.focus({preventScroll: true});
  cards[step - 1].scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
}
form.addEventListener('submit', event => {event.preventDefault();});
async function preparePreview(revision: number) {
  if (revision !== previewRevision || !previewKey || previewInFlight || working || created) return;
  previewInFlight = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    // Serialize requests so a superseded response can be replaced without storing
    // a new plan for every edit. Never render it or reuse its confirmation.
    const plan = await call('/api/preview', {...JSON.parse(previewKey), ...(planId ? {replacePlanId: planId} : {})}, controller.signal);
    planId = plan.id;
    if (revision !== previewRevision) return;
    previewReady = true;
    previewPreparedAt = Date.now();
    element('target').textContent = `${plan.repository} · ${plan.spec.visibility}`;
    element<HTMLInputElement>('confirm').checked = false;
    const container = element('files'); container.replaceChildren(); element('content').hidden = true;
    const restoreFile = Object.hasOwn(plan.files, selectedFile) ? selectedFile : Object.keys(plan.files)[0];
    for (const path of Object.keys(plan.files)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'file'; button.textContent = path; button.setAttribute('aria-pressed', 'false');
      button.onclick = () => {
        if (selectedFile !== path) contentScroll = {top: 0, left: 0};
        selectedFile = path;
        for (const file of container.querySelectorAll('button')) file.setAttribute('aria-pressed', String(file === button));
        element('content').textContent = plan.files[path]; element('content').hidden = false;
        element('content').setAttribute('aria-label', `${path} content`);
        element('content').scrollTop = contentScroll.top; element('content').scrollLeft = contentScroll.left;
      };
      container.appendChild(button);
      if (path === restoreFile) button.click();
    }
    element('preview').hidden = false; element('hint').textContent = `${Object.keys(plan.files).length} files. Select a file to inspect it.`;
    container.scrollTop = fileScroll;
    element('content').scrollTop = contentScroll.top; element('content').scrollLeft = contentScroll.left;
    element('review-status').textContent = 'Review the files and confirm below. Changes to your settings update this preview automatically.';
    // Review is ready below automation. Keep the reader's focus in place.
    previewExpiry = setTimeout(() => {previewKey = ''; controls();}, 14 * 60000);
  } catch (error) {
    if (revision === previewRevision) {previewFailed = true; element('review-status').textContent = (error as Error).message;}
  } finally {
    clearTimeout(timeout);
    previewInFlight = false;
    if (revision === previewRevision) previewPending = false;
    else if (previewKey && !working && !created) queuePreview();
    controls();
  }
}
element('retry-preview').onclick = () => {previewKey = ''; controls();};
function creationProgress(active: boolean) {
  creating = active;
  clearInterval(creationTimer);
  element('creation-progress').hidden = !active; element('create-spinner').hidden = !active;
  element('create').setAttribute('aria-busy', String(active));
  element('create-label').textContent = active ? 'Creating repository…' : 'Create repository';
  if (active) {
    const started = Date.now();
    element('creation-elapsed').textContent = '0s elapsed';
    creationTimer = setInterval(() => {element('creation-elapsed').textContent = `${Math.floor((Date.now() - started) / 1000)}s elapsed`;}, 1000);
  }
  controls();
}
element('create').onclick = () => void busy(async () => {
  if (creationFailed || authRequired || !previewReady || !element<HTMLInputElement>('confirm').checked || created) throw new Error('Review a fresh preview and tick the confirmation checkbox.');
  if (Date.now() - previewPreparedAt >= 14 * 60000) {previewKey = ''; return;}
  clearTimeout(previewExpiry); creationProgress(true); output.textContent = '';
  element('creation-error').hidden = true;
  try {
    const result = await call('/api/create', {planId, confirm: true});
    if (result.state !== 'complete') throw new Error(result.error || 'Setup did not finish.');
    created = true; previewReady = false;
    output.textContent = '';
    element<HTMLAnchorElement>('repository-link').href = `https://github.com/${result.repository}`;
    element('success-copy').textContent = `${result.repository} was created and configured.`;
    const repositoryUrl = `https://github.com/${result.repository}`;
    element<HTMLAnchorElement>('actions-link').href = `${repositoryUrl}/actions`;
    const docsLink = element<HTMLAnchorElement>('documentation-link');
    element('documentation-followup').hidden = !hasAutomation(); docsLink.href = `${repositoryUrl}/settings/pages`;
    renderApps();
    controls(); focusStep(6);
    if (hasAutomation()) void call('/api/status', {planId}).then(status => {
      if (!created || status.planId !== planId || !status.pagesUrl) return;
      const url = new URL(status.pagesUrl);
      if (url.protocol === 'https:') {docsLink.href = url.href; docsLink.textContent = 'view your documentation';}
    }).catch(() => { /* Keep the Pages settings link if the URL cannot be read. */ });
    void loadApps();
  } catch (error) {
    creationFailed = true;
    element('creation-error').textContent = (error as Error).message; element('creation-error').hidden = false;
    element('creation-recovery').hidden = false;
    element<HTMLAnchorElement>('interrupted-repository-link').href = `https://github.com/${owner.value}/${name.value}.jl`;
  }
  finally {creationProgress(false);}
});
element('create-another').onclick = () => {
  form.reset(); authors.value = defaultAuthor; planId = ''; created = false;
  creationFailed = false; authorsTouched = false; advancedToAutomation = false; selectedFile = ''; fileScroll = 0; contentScroll = {top: 0, left: 0};
  element('documentation-link').textContent = 'check documentation deployment';
  element('creation-error').hidden = true;
  automation(); scheduleAvailability(); void loadApps(); name.focus();
};
element('retry-profile').onclick = () => {void loadProfile();};
function restoreSettings() {
  try {
    const saved = sessionStorage.getItem(draftKey); sessionStorage.removeItem(draftKey);
    if (!saved) return;
    const draft = JSON.parse(saved);
    if (draft.login !== profileLogin || Date.now() - draft.savedAt > 3600000) return;
    for (const id of ['owner', 'package-name', 'authors', 'description', 'template', 'visibility']) {
      if (typeof draft[id] !== 'string' || draft[id].length > 4000) continue;
      const input = element<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(id);
      if (input instanceof HTMLSelectElement && ![...input.options].some(o => o.value === draft[id])) continue;
      input.value = draft[id];
    }
  } catch { /* Storage is optional; a fresh setup remains usable. */ }
}
document.getElementById('reconnect')?.addEventListener('click', () => {
  try {
    const settings = Object.fromEntries(['owner', 'package-name', 'authors', 'description', 'template', 'visibility'].map(id => [id, element<HTMLInputElement>(id).value]));
    sessionStorage.setItem(draftKey, JSON.stringify({...settings, login: profileLogin, savedAt: Date.now()}));
  } catch { /* Some browsers disable session storage. */ }
});
document.getElementById('logout')?.addEventListener('click', () => void busy(async () => {await call('/auth/logout', {}); try {sessionStorage.removeItem(draftKey);} catch {} location.reload();}));
automation(); controls();
if (document.body.dataset.authenticated === 'true') void loadProfile();
