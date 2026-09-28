import { escapeHtml } from './http.js';

// Workflow and styling adapted from PkgFactory.jl at 7c7d4af. Authentication
// uses the agreed server-side session and PKCE instead of tab-held tokens.
export function page(csrf: string, publicWeb: boolean, authenticated: boolean) {
  return `<!doctype html><html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="csrf-token" content="${escapeHtml(csrf)}">
  <title>PkgFactory</title><link rel="icon" type="image/svg+xml" href="/assets/logo.svg"><link rel="stylesheet" href="/style.css"><script src="/app.js" defer></script>
  </head><body data-authenticated="${authenticated}">
  <header class="app-header"><div class="header-inner">
    <a class="brand" href="/" aria-label="PkgFactory home"><img class="brand-logo" src="/assets/logo.svg" width="52" height="48" alt=""><span>PkgFactory</span></a>
    <div class="header-actions">
    <a class="github-link" href="https://github.com/JuliaPackageFactory/PkgFactory.ts" target="_blank" rel="noreferrer">GitHub</a></div>
  </div></header>
  <main class="main-content"><section class="intro" aria-labelledby="page-title"><p class="eyebrow">JULIA PACKAGE STARTER</p><h1 id="page-title">Create a package repository.</h1>
    <p>Connect GitHub, choose a template, and publish a repository with CI, documentation, and release automation already configured.</p></section>
  <div class="workflow" aria-label="Package creation workflow">
    <section id="connect-panel" class="workflow-card is-active" data-step="1"><div class="card-heading"><span class="step-badge">1</span><div><div class="title-row"><h2>Connect GitHub</h2><span id="connect-state" class="step-state">Current step</span></div><p id="connect-description"><span id="connect-status" role="status">${authenticated ? 'Loading your GitHub profile and repository owners…' : 'Connect first to choose a repository owner and fill in your author name.'}</span>${publicWeb && authenticated ? ' <button id="logout" class="inline-action" type="button">Click here to sign out.</button>' : ''}</p></div></div>
      <div id="connect-actions" class="card-body">
      ${publicWeb ? '<a id="connect-button" class="button button-primary" href="/auth/login">Connect with GitHub</a><p class="permission-copy">Uses your profile, organization membership, repository, and workflow permissions. Grant organization access only where you want to create packages.</p>' : '<p>Start the local Web with <code>pkgfactory web --gh</code>, <code>--device</code>, or a configured <code>GITHUB_TOKEN</code>.</p>'}
      <button id="retry-profile" type="button" class="button button-secondary" ${authenticated ? '' : 'hidden'}>Retry account lookup</button>
      <div id="connect-error" class="notice notice-error" role="alert" hidden></div></div>
    </section>
    <form id="package-form" class="package-flow" hidden>
      <fieldset id="package-fields" class="package-flow" aria-label="Package settings">
        <section class="workflow-card is-active" data-step="2"><div class="card-heading"><span class="step-badge">2</span><div><div class="title-row"><h2>Create repository</h2><span id="repository-state" class="step-state">Required</span></div><p>Choose where the repository will live and give your package its Julia name.</p></div></div>
          <div class="card-body field-grid two-columns">
            <label class="field"><span>Repository owner</span><select id="owner" name="owner" required aria-describedby="owner-help"></select><small id="owner-help">Your account and organizations where you are an owner. Missing an organization? Check its access in GitHub's PkgFactory authorization settings.</small></label>
            <label class="field"><span>Visibility</span><select id="visibility" name="visibility"><option value="public">Public</option><option value="private">Private</option></select></label>
            <label class="field full-width"><span>Package name</span><div class="input-suffix"><input id="package-name" name="name" autocomplete="off" placeholder="MyPkg" pattern="[A-Z][A-Za-z0-9]*(\\.jl)?" maxlength="100" required aria-describedby="package-availability"><span>.jl</span></div><small>Start with A–Z; use letters and digits. The repository gets a .jl suffix.</small><small id="package-availability" class="availability-status" role="status" aria-live="polite"></small></label>
          </div>
        </section>
        <section class="workflow-card" data-step="3"><div class="card-heading"><span class="step-badge">3</span><div><h2>Generate package template</h2><p>Select the starter files and metadata for the initial package commit.</p></div></div><div class="card-body">
          <label class="field"><span>Authors</span><textarea id="authors" name="authors" required rows="2" maxlength="4000"></textarea><small>Filled from your GitHub profile. Edit freely; use one author per line.</small></label>
          <label class="field"><span>Description</span><textarea id="description" name="description" maxlength="2000" rows="2" placeholder="A concise description of what this package does."></textarea></label>
          <label class="field"><span>Template</span><select id="template" name="template"><option value="all-in-one">All-in-one · Quality checks, documentation, and examples</option><option value="simple">Simple · Documentation and releases</option><option value="minimum">Minimum · Package and tests</option></select></label>
        </div></section>
        <section class="workflow-card" data-step="4"><div class="card-heading"><span class="step-badge">4</span><div><h2>Configure automation</h2><p id="automation-description">Documenter and TagBot are configured automatically.</p></div></div><div class="card-body">
          <div id="documenter-row" class="automation-row"><div class="automation-copy"><strong>Documenter deployment</strong><small>Deploy key and <code>DOCUMENTER_KEY</code> repository secret</small></div><span class="configured-pill">Automatic</span></div>
          <div id="codecov-field" class="field"><span>Codecov GitHub App</span><small>After creation, grant the Codecov GitHub App access to your repository. Coverage uploads use GitHub OIDC; no upload token is required.</small><a href="https://github.com/apps/codecov" target="_blank" rel="noreferrer">Install or configure Codecov GitHub App</a></div>
        </div></section>
      </fieldset>
      <section class="workflow-card create-card" data-step="5"><div class="card-heading"><span class="step-badge">5</span><div><h2>Review and create</h2><p>Preview the generated files before creating your repository.</p></div></div><div class="card-body">
        <button id="preview-button" class="button button-primary" type="submit" disabled>Preview package</button>
        <div id="preview" hidden><p id="target"></p><p id="hint"></p><div class="file-preview"><div id="files" aria-label="Generated files"></div><pre id="content" tabindex="0" hidden></pre></div>
          <label class="check-field"><input type="checkbox" id="confirm"><span>I reviewed this preview and want to create this repository.</span></label>
          <button id="create" class="button button-primary" type="button" disabled>Create repository</button>
        </div>
        <div id="success-panel" class="creation-result" hidden><h3>Your package is ready.</h3><p id="success-copy"></p><div class="success-actions"><a id="repository-link" class="button button-success" target="_blank" rel="noreferrer">Go to repository</a><button id="create-another" class="button button-secondary" type="button">Create another package</button></div>
          <section class="registration-guide"><h3>Publish to Julia's General registry</h3><p>When your public package is ready, <a href="https://github.com/apps/juliaregistrator" target="_blank" rel="noreferrer">install or configure Registrator</a> and follow the <a href="https://github.com/JuliaRegistries/General#registering-a-package-in-general" target="_blank" rel="noreferrer">General registration guidelines</a>.</p></section>
        </div>
      </div></section>
    </form>
    <section id="recovery" class="workflow-card" hidden><div class="card-heading"><span class="step-badge">↻</span><div><h2>Resume interrupted setup</h2><p>Check the saved plan's status before explicitly resuming it.</p></div></div><div class="card-body"><label class="field"><span>Saved plan ID</span><input id="planId" placeholder="Paste the plan ID from your interrupted setup"></label><div class="success-actions"><button id="status" class="button button-secondary" type="button">Check status</button><button id="resume" class="button button-secondary" type="button">Resume setup</button></div></div></section>
    <output id="result" role="status" aria-live="polite"></output>
  </div></main><footer class="app-footer"><span>PkgFactory</span><span>Julia package scaffolding through the GitHub API</span></footer></body></html>`;
}
