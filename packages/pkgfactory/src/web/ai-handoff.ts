type PromptLanguage = 'en' | 'ja';

export function setupAiHandoff() {
  const element = <T = HTMLElement>(id: string) => document.getElementById(id) as T;
  const panel = element('ai-handoff');
  const editor = element<HTMLTextAreaElement>('ai-prompt');
  const copy = element<HTMLButtonElement>('copy-prompt');
  const status = element('prompt-copy-status');
  const chatgpt = element<HTMLAnchorElement>('open-chatgpt');
  const codex = element<HTMLAnchorElement>('open-codex');
  const languages = [...panel.querySelectorAll<HTMLButtonElement>('[data-prompt-language]')];
  let language: PromptLanguage = navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
  let repositoryUrl = '';
  let drafts = {en: '', ja: ''};
  let copyRevision = 0;

  function updateLinks() {
    const usable = !!repositoryUrl && !!editor.value.trim();
    copy.disabled = !usable;
    for (const link of [chatgpt, codex]) {
      if (usable) link.removeAttribute('aria-disabled');
      else {link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true');}
    }
    if (usable) {
      chatgpt.href = 'https://chatgpt.com/?' + new URLSearchParams({q: editor.value});
      codex.href = 'codex://new?' + new URLSearchParams({prompt: editor.value, originUrl: `${repositoryUrl}.git`});
    }
    copyRevision++;
    status.textContent = '';
  }
  function render() {
    editor.value = drafts[language];
    editor.lang = language;
    for (const button of languages) button.setAttribute('aria-pressed', String(button.dataset.promptLanguage === language));
    updateLinks();
  }
  for (const button of languages) button.addEventListener('click', () => {
    drafts[language] = editor.value;
    language = button.dataset.promptLanguage as PromptLanguage;
    render();
  });
  editor.addEventListener('input', event => {
    event.stopPropagation();
    drafts[language] = editor.value;
    updateLinks();
  });
  copy.addEventListener('click', async () => {
    if (copy.disabled) return;
    const revision = ++copyRevision;
    try {
      await navigator.clipboard.writeText(editor.value);
      if (revision === copyRevision) status.textContent = 'Copied. Paste it into your AI agent.';
    } catch {
      if (revision !== copyRevision) return;
      editor.focus(); editor.select();
      status.textContent = 'Text selected. Press Ctrl+C / ⌘C, or use your device’s Copy action.';
    }
  });

  // Drafts stay in this page and are replaced only when starting another package.
  return (url = '') => {
    repositoryUrl = url;
    drafts = url ? {
      en: `Interview me to define requirements for the following Julia package, then implement and verify the agreed solution.\n${url}`,
      ja: `次のJuliaパッケージについて、私へのヒアリングで要件を定義し、合意した内容を実装・検証してください。\n${url}`,
    } : {en: '', ja: ''};
    panel.hidden = !url;
    element('ai-handoff-placeholder').hidden = !!url;
    render();
  };
}
