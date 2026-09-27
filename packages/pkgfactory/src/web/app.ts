const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let files: Record<string, string> = {};
const form = element<HTMLFormElement>('spec');
const output = element<HTMLOutputElement>('result');
const csrf = document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')!.content;
async function call(path: string, body: unknown) {
  const response = await fetch(path, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', 'X-PkgFactory-CSRF': csrf}, body: JSON.stringify(body)});
  const data = await response.json() as any; if (!response.ok || data.error) throw new Error(data.error || 'Request failed'); return data;
}
async function busy(fn: () => Promise<void>) {
  const buttons = [...document.querySelectorAll('button')]; buttons.forEach(b => b.disabled = true); output.textContent = 'Working…';
  try {await fn();} catch (error) {output.textContent = `${(error as Error).message} Your plan ID is retained below.`;}
  finally {buttons.forEach(b => b.disabled = false);}
}
form.addEventListener('input', () => {element('actions').hidden = true;});
form.addEventListener('submit', event => {event.preventDefault(); void busy(async () => {
  const data = Object.fromEntries(new FormData(form));
  const plan = await call('/api/preview', {...data, authors: String(data.authors).split('\n').map(x => x.trim()).filter(Boolean)});
  files = plan.files;
  element<HTMLInputElement>('planId').value = plan.id;
  element('target').textContent = `Create ${plan.repository} · ${plan.spec.visibility}`;
  element<HTMLInputElement>('confirm').checked = false;
  const container = element('files'); container.replaceChildren();
  for (const path of Object.keys(files)) {const button = document.createElement('button'); button.className = 'file'; button.textContent = path; button.onclick = () => {element('content').textContent = files[path]; element('content').hidden = false;}; container.appendChild(button);}
  element('actions').hidden = false; element('hint').textContent = `${Object.keys(files).length} files. Select a file to inspect it.`; output.textContent = 'Preview saved for 15 minutes.';
});});
for (const action of ['create', 'status', 'resume']) element(action).onclick = () => void busy(async () => {
  if (action === 'create' && !element<HTMLInputElement>('confirm').checked) throw new Error('Review the preview and tick the confirmation checkbox');
  if (action === 'resume' && !window.confirm('Reconcile GitHub state and resume this saved plan?')) {output.textContent = 'Resume cancelled.'; return;}
  const result = await call(`/api/${action}`, {planId: element<HTMLInputElement>('planId').value, confirm: true});
  output.textContent = JSON.stringify(result, null, 2);
});
document.getElementById('logout')?.addEventListener('click', () => void busy(async () => {await call('/auth/logout', {}); location.reload();}));
