export {};
const element = <T = HTMLElement>(id: string) => document.getElementById(id) as T;
const form = element<HTMLFormElement>('package-form');
const fields = element<HTMLFieldSetElement>('package-fields');
const output = element<HTMLOutputElement>('result');
const owner = element<HTMLSelectElement>('owner');
const name = element<HTMLInputElement>('package-name');
const authors = element<HTMLTextAreaElement>('authors');
const planId = element<HTMLInputElement>('planId');
const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')!.content;
let profileReady = false, working = false, available = false, previewReady = false;
let availabilityRevision = 0, availabilityTimer: ReturnType<typeof setTimeout> | undefined, availabilityAbort: AbortController | undefined;
let defaultAuthor = '';

async function call(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(path, {method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
    headers: body === undefined ? {} : {'Content-Type': 'application/json', 'X-PkgFactory-CSRF': csrf},
    body: body === undefined ? undefined : JSON.stringify(body), signal});
  const data = await response.json() as any;
  if (!response.ok || data.error) throw new Error(data.error || 'Request failed');
  return data;
}
function controls() {
  fields.disabled = working;
  element<HTMLButtonElement>('preview-button').disabled = working || !profileReady || !available;
  element<HTMLButtonElement>('create').disabled = working || !previewReady || !element<HTMLInputElement>('confirm').checked;
  for (const id of ['status', 'resume']) element<HTMLButtonElement>(id).disabled = working || !profileReady || !planId.value.trim();
  for (const id of ['logout', 'retry-profile', 'create-another']) {const button = document.getElementById(id) as HTMLButtonElement | null; if (button) button.disabled = working;}
}
async function busy(fn: () => Promise<void>) {
  if (working) return;
  working = true; controls(); output.textContent = 'Working…';
  try {await fn();} catch (error) {output.textContent = (error as Error).message + (planId.value ? ' Your saved plan ID is retained below.' : '');}
  finally {working = false; controls();}
}
function invalidatePreview() {
  previewReady = false; element('preview').hidden = true; element('success-panel').hidden = true;
  element<HTMLInputElement>('confirm').checked = false; controls();
}
function availability(message: string, state = 'checking') {
  available = state === 'available';
  const notice = element('package-availability'); notice.textContent = message; notice.className = `availability-status is-${state}`;
  element('repository-state').textContent = available ? 'Ready' : 'Required'; controls();
}
async function checkAvailability(revision: number) {
  if (!profileReady || !name.value.trim() || !name.validity.valid) {availability(name.value ? 'Enter a Julia package name starting with A–Z, using letters and digits.' : 'Enter a package name to check GitHub.', 'unavailable'); return;}
  const controller = new AbortController(); availabilityAbort = controller;
  availability('Checking GitHub…');
  try {
    const result = await call('/api/github/availability', {owner: owner.value, name: name.value}, controller.signal);
    if (revision !== availabilityRevision) return;
    availability(result.available ? `${result.repository} is available. GitHub permissions are checked again when creating.` : `${result.repository} already exists. Use your saved plan ID below to resume an interrupted setup.`, result.available ? 'available' : 'unavailable');
  } catch (error) {if (revision === availabilityRevision) availability((error as Error).message, 'unavailable');}
}
function scheduleAvailability() {
  clearTimeout(availabilityTimer); availabilityAbort?.abort();
  const revision = ++availabilityRevision;
  availability('Checking repository name…');
  availabilityTimer = setTimeout(() => {void checkAvailability(revision);}, 450);
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
      if (!authors.value) authors.value = profile.user.name;
      defaultAuthor = profile.user.name;
      element('connect-status').textContent = `Connected as @${profile.user.login}.`;
      element('connect-state').textContent = 'Completed';
      element('connect-panel').classList.add('is-complete'); element('connect-panel').classList.remove('is-active');
      element('connect-actions').hidden = true;
      profileReady = true; form.hidden = false; element('recovery').hidden = false; output.textContent = '';
      scheduleAvailability();
    } catch (error) {
      profileReady = false; form.hidden = true; element('recovery').hidden = true;
      element('connect-actions').hidden = false;
      element('connect-error').textContent = (error as Error).message; element('connect-error').hidden = false;
      element('connect-status').textContent = 'GitHub account lookup did not complete. Retry or connect again.';
      output.textContent = '';
    }
  });
}
function automation() {
  const minimum = element<HTMLSelectElement>('template').value === 'minimum';
  element('documenter-row').hidden = minimum; element('codecov-field').hidden = minimum;
  element('automation-description').textContent = minimum ? 'Minimum includes package tests and CI. Select Simple or All-in-one for documentation and releases.' : 'Documenter and TagBot are configured automatically.';
}
form.addEventListener('input', invalidatePreview);
owner.addEventListener('change', scheduleAvailability);
name.addEventListener('input', scheduleAvailability);
element('template').addEventListener('change', automation);
element('confirm').addEventListener('input', event => {event.stopPropagation(); controls();});
planId.addEventListener('input', () => {previewReady = false; controls();});
form.addEventListener('submit', event => {event.preventDefault(); void busy(async () => {
  if (!profileReady || !available) throw new Error('Connect GitHub and check the repository name first.');
  const plan = await call('/api/preview', {owner: owner.value, name: name.value, authors: authors.value.split('\n').map(x => x.trim()).filter(Boolean),
    description: element<HTMLTextAreaElement>('description').value, template: element<HTMLSelectElement>('template').value, visibility: element<HTMLSelectElement>('visibility').value});
  planId.value = plan.id; previewReady = true;
  element('target').textContent = `${plan.repository} · ${plan.spec.visibility}`;
  element<HTMLInputElement>('confirm').checked = false;
  const container = element('files'); container.replaceChildren(); element('content').hidden = true;
  for (const path of Object.keys(plan.files)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'file'; button.textContent = path;
    button.onclick = () => {element('content').textContent = plan.files[path]; element('content').hidden = false;}; container.appendChild(button);
  }
  element('preview').hidden = false; element('hint').textContent = `${Object.keys(plan.files).length} files. Select a file to inspect it.`;
  output.textContent = `Preview saved for 15 minutes. Plan ID: ${plan.id}`;
});});
function showResult(result: any) {
  output.textContent = `${result.repository}: ${result.state}.${result.pending ? ` Last operation: ${result.pending}.` : ''}${result.error ? ` ${result.error}` : ''}${result.canResumeAfter ? ` Resume after ${result.canResumeAfter}.` : ''}`;
  if (result.state !== 'complete') return;
  previewReady = false;
  element<HTMLAnchorElement>('repository-link').href = `https://github.com/${result.repository}`;
  element('success-copy').textContent = `${result.repository} was created and configured.`; element('success-panel').hidden = false;
}
for (const action of ['create', 'status', 'resume']) element(action).onclick = () => void busy(async () => {
  if (action === 'create' && (!previewReady || !element<HTMLInputElement>('confirm').checked)) throw new Error('Review a fresh preview and tick the confirmation checkbox.');
  if (!planId.value.trim()) throw new Error('Enter the saved plan ID.');
  if (action === 'resume' && !window.confirm('Inspect GitHub state and explicitly resume this saved plan?')) {output.textContent = 'Resume cancelled.'; return;}
  showResult(await call(`/api/${action}`, {planId: planId.value.trim(), confirm: true}));
});
element('create-another').onclick = () => {
  form.reset(); authors.value = defaultAuthor; planId.value = ''; invalidatePreview(); automation(); scheduleAvailability(); output.textContent = ''; name.focus();
};
element('retry-profile').onclick = () => {void loadProfile();};
document.getElementById('logout')?.addEventListener('click', () => void busy(async () => {await call('/auth/logout', {}); location.reload();}));
automation(); controls();
if (document.body.dataset.authenticated === 'true') void loadProfile();
