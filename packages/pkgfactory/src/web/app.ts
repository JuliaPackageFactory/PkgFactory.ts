import { appSlugs, unknownInstallations, type AppInstallations } from '../github/apps.js';
import { normalizeAuthorSeparators, parseAuthors, workflowStates } from './workflow.js';

const element = <T = HTMLElement>(id: string) => document.getElementById(id) as T;
const form = element<HTMLFormElement>('package-form');
const fields = element<HTMLFieldSetElement>('package-fields');
const output = element<HTMLOutputElement>('result');
const owner = element<HTMLSelectElement>('owner');
const name = element<HTMLInputElement>('package-name');
const authors = element<HTMLTextAreaElement>('authors');
const template = element<HTMLSelectElement>('template');
const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')!.content;
const cards = [...document.querySelectorAll<HTMLElement>('.workflow-card[data-step]')];
let profileReady = false, working = false, available = false, previewReady = false, created = false;
let automationReviewed = false, planId = '';
let availabilityRevision = 0, availabilityTimer: ReturnType<typeof setTimeout> | undefined, availabilityAbort: AbortController | undefined;
let appsRevision = 0, appsAbort: AbortController | undefined, appsLoading = false;
let installations: AppInstallations = unknownInstallations();
const confirmedApps = new Map<string, Set<string>>();
let defaultAuthor = '';

async function call(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(path, {method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: body === undefined ? {} : {'Content-Type': 'application/json', 'X-PkgFactory-CSRF': csrf},
    body: body === undefined ? undefined : JSON.stringify(body), signal});
  const data = await response.json() as any;
  if (!response.ok || data.error) throw new Error(data.code === 'exists' ? 'This repository already exists. Choose a different package name.' : data.error || 'Request failed');
  return data;
}
function validAuthors() {
  const values = parseAuthors(authors.value);
  const valid = values.length > 0 && values.length <= 20 && values.every(author => author.length <= 200 && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(author));
  authors.setCustomValidity(valid ? '' : 'Enter 1–20 authors, up to 200 characters each, without control characters.');
  return valid;
}
function controls() {
  const metadataReady = validAuthors();
  const states = workflowStates([profileReady, available, !!template.value && metadataReady, automationReviewed, created, false]);
  for (const [index, card] of cards.entries()) {
    const state = states[index];
    card.classList.toggle('is-complete', state === 'complete');
    card.classList.toggle('is-active', state === 'ready');
    if (state === 'ready') card.setAttribute('aria-current', 'step'); else card.removeAttribute('aria-current');
    const label = card.querySelector<HTMLElement>('.step-state')!;
    const text = state === 'complete' ? 'Completed' : state === 'ready' ? 'Ready' : 'Upcoming';
    if (label.textContent !== text) label.textContent = text;
  }
  fields.disabled = working || created;
  element<HTMLButtonElement>('continue-automation').disabled = working || created || states[2] !== 'complete';
  element<HTMLButtonElement>('preview-button').disabled = working || created || states[4] !== 'ready';
  element<HTMLButtonElement>('create').disabled = working || created || !previewReady || !element<HTMLInputElement>('confirm').checked;
  element<HTMLButtonElement>('refresh-apps').disabled = working || created || !profileReady || appsLoading;
  element<HTMLInputElement>('confirm').disabled = working || created;
  element('success-placeholder').hidden = created;
  element('success-panel').hidden = !created;
  for (const id of ['logout', 'retry-profile', 'create-another']) {const button = document.getElementById(id) as HTMLButtonElement | null; if (button) button.disabled = working;}
}
async function busy(fn: () => Promise<void>) {
  if (working) return;
  working = true; controls(); output.textContent = 'Working…';
  try {await fn();} catch (error) {output.textContent = (error as Error).message;}
  finally {working = false; controls();}
}
function invalidatePreview() {
  previewReady = false; element('preview').hidden = true;
  element<HTMLInputElement>('confirm').checked = false; output.textContent = ''; controls();
}
function availability(message: string, state = 'checking') {
  available = state === 'available';
  const notice = element('package-availability'); notice.textContent = message; notice.className = `availability-status is-${state}`;
  controls();
}
async function checkAvailability(revision: number) {
  if (!profileReady || !name.value.trim() || !name.validity.valid) {availability(name.value ? 'Enter a Julia package name starting with A–Z, using letters and digits.' : 'Enter a package name to check GitHub.', 'unavailable'); return;}
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
  availability('Checking repository name…');
  availabilityTimer = setTimeout(() => {void checkAvailability(revision);}, 450);
}
function renderApps() {
  const confirmed = confirmedApps.get(owner.value);
  for (const slug of appSlugs) {
    const installation = installations[slug];
    const selfConfirmed = installation.state === 'unknown' && !!confirmed?.has(slug);
    const installed = installation.state === 'installed' || selfConfirmed;
    const badge = element(`${slug}-state`);
    badge.className = installed ? 'configured-pill' : 'app-state';
    badge.textContent = appsLoading ? 'Checking…' : installed ? 'Installed' : installation.state === 'suspended' ? 'Suspended' : installation.state === 'not-installed' ? 'Not installed' : 'Check on GitHub';
    // A manual confirmation is explicitly labelled, scoped to the selected owner,
    // and never treated as evidence that the future repository has app access.
    element(`${slug}-confirmation`).hidden = appsLoading || installation.state !== 'unknown';
    element<HTMLInputElement>(`${slug}-confirmed`).checked = selfConfirmed;
    element(`${slug}-detail`).textContent = appsLoading ? `Checking apps for @${owner.value}…`
      : selfConfirmed ? `Confirmed by you for @${owner.value}. Check access for the new repository after creation.`
      : installation.state === 'installed' ? installation.selection === 'all' ? `Installed for all repositories owned by @${owner.value}.` : `Installed for selected repositories owned by @${owner.value}. Add the new repository after creation.`
      : installation.state === 'suspended' ? `Installation for @${owner.value} is suspended. Review it on GitHub.`
      : installation.state === 'not-installed' ? `Not installed for @${owner.value}. You can install it after creation.`
      : `Check installation for @${owner.value} on GitHub, then confirm below.`;
  }
}
async function loadApps() {
  appsAbort?.abort();
  const revision = ++appsRevision;
  installations = unknownInstallations();
  if (!profileReady) {appsLoading = false; renderApps(); controls(); return;}
  const controller = new AbortController(); appsAbort = controller;
  appsLoading = true; renderApps(); controls();
  try {
    const result = await call('/api/github/apps', {owner: owner.value}, controller.signal);
    if (revision === appsRevision) installations = result;
  } catch { /* Optional lookup: leave status unknown and allow checking on GitHub. */ }
  finally {if (revision === appsRevision) {appsLoading = false; renderApps(); controls();}}
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
      if (!authors.value) authors.value = defaultAuthor;
      element('connect-status').textContent = `Connected as @${profile.user.login}.`;
      element('connect-actions').hidden = true;
      profileReady = true; form.hidden = false; output.textContent = '';
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
  element('documenter-state').className = documentation ? 'configured-pill' : 'app-state';
  element('documenter-detail').textContent = documentation ? 'Deploy key and DOCUMENTER_KEY repository secret are configured during creation.'
    : 'Select Simple or All-in-one to include documentation deployment.';
  element('codecov-description').textContent = documentation ? 'Coverage reports and pull request checks. Uploads use GitHub OIDC; no upload token is required.'
    : 'Select Simple or All-in-one to include coverage uploads. The app can be configured at any time.';
  element('juliaregistrator-description').textContent = privateRepository ? 'General registry registration requires a public repository. You can publish this package after making it public.'
    : 'For publishing a public package to Julia’s General registry when it is ready. Optional for repository creation.';
  element('registration-guide').hidden = privateRepository;
  element('automation-description').textContent = !template.value ? 'Choose a template to see which automation will be configured.'
    : minimum ? 'Minimum includes package tests and CI. Documentation, coverage, and release workflows are not included.'
    : 'Documenter and TagBot are configured automatically.';
}
function normalizeAuthors() {
  const normalized = normalizeAuthorSeparators(authors.value);
  if (normalized === authors.value) return;
  const {selectionStart, selectionEnd, selectionDirection} = authors;
  authors.value = normalized;
  authors.setSelectionRange(selectionStart, selectionEnd, selectionDirection);
}
authors.addEventListener('input', event => {if (!(event as InputEvent).isComposing) normalizeAuthors();});
authors.addEventListener('compositionend', () => {normalizeAuthors(); controls();});
form.addEventListener('input', event => {
  if ((event.target as HTMLElement).closest('.app-confirmation')) return;
  const step = (event.target as HTMLElement).closest<HTMLElement>('[data-step]')?.dataset.step;
  if (step === '3') automationReviewed = false;
  if (event.target === owner || (event.target as HTMLElement).id === 'visibility') automationReviewed = false;
  invalidatePreview();
});
owner.addEventListener('change', () => {scheduleAvailability(); void loadApps();});
name.addEventListener('input', scheduleAvailability);
template.addEventListener('change', () => {
  automation(); controls();
  if (template.value && profileReady && available && validAuthors()) focusStep(4);
});
element('visibility').addEventListener('change', automation);
element('confirm').addEventListener('input', event => {event.stopPropagation(); controls();});
for (const slug of appSlugs) element(`${slug}-confirmed`).addEventListener('input', () => {
  const confirmed = confirmedApps.get(owner.value) ?? new Set<string>();
  if (element<HTMLInputElement>(`${slug}-confirmed`).checked) confirmed.add(slug); else confirmed.delete(slug);
  confirmedApps.set(owner.value, confirmed); renderApps();
});
element('refresh-apps').onclick = () => {void loadApps();};
function focusStep(step: number) {
  const heading = cards[step - 1].querySelector<HTMLElement>('h2')!;
  heading.focus({preventScroll: true});
  cards[step - 1].scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start'});
}
element('continue-automation').onclick = () => {
  if (!profileReady || !available || !template.value || !validAuthors()) return;
  automationReviewed = true; controls(); focusStep(5);
};
form.addEventListener('submit', event => {event.preventDefault(); void busy(async () => {
  if (!profileReady || !available || !template.value || !automationReviewed || !validAuthors() || created) throw new Error('Complete the package settings and review automation first.');
  const plan = await call('/api/preview', {owner: owner.value, name: name.value, authors: parseAuthors(authors.value),
    description: element<HTMLTextAreaElement>('description').value, template: template.value, visibility: element<HTMLSelectElement>('visibility').value});
  planId = plan.id; previewReady = true;
  element('target').textContent = `${plan.repository} · ${plan.spec.visibility}`;
  element<HTMLInputElement>('confirm').checked = false;
  const container = element('files'); container.replaceChildren(); element('content').hidden = true;
  for (const path of Object.keys(plan.files)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'file'; button.textContent = path; button.setAttribute('aria-pressed', 'false');
    button.onclick = () => {
      for (const file of container.querySelectorAll('button')) file.setAttribute('aria-pressed', String(file === button));
      element('content').textContent = plan.files[path]; element('content').hidden = false;
      element('content').setAttribute('aria-label', `${path} content`);
    };
    container.appendChild(button);
  }
  container.querySelector<HTMLButtonElement>('button')?.click();
  element('preview').hidden = false; element('hint').textContent = `${Object.keys(plan.files).length} files. Select a file to inspect it.`;
  output.textContent = 'Preview ready. Review the files and confirm below. The preview is available for 15 minutes.';
});});
element('create').onclick = () => void busy(async () => {
  if (!previewReady || !element<HTMLInputElement>('confirm').checked || created) throw new Error('Review a fresh preview and tick the confirmation checkbox.');
  const result = await call('/api/create', {planId, confirm: true});
  if (result.state !== 'complete') {output.textContent = result.error || 'Setup did not finish.'; return;}
  created = true; previewReady = false;
  output.textContent = '';
  element<HTMLAnchorElement>('repository-link').href = `https://github.com/${result.repository}`;
  element('success-copy').textContent = `${result.repository} was created and configured.`;
  controls(); focusStep(6);
  void loadApps();
});
element('create-another').onclick = () => {
  form.reset(); authors.value = defaultAuthor; planId = ''; created = false; automationReviewed = false;
  invalidatePreview(); automation(); scheduleAvailability(); void loadApps(); name.focus();
};
element('retry-profile').onclick = () => {void loadProfile();};
document.getElementById('logout')?.addEventListener('click', () => void busy(async () => {await call('/auth/logout', {}); location.reload();}));
automation(); controls();
if (document.body.dataset.authenticated === 'true') void loadProfile();
