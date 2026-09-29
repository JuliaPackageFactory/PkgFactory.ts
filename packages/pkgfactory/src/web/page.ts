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
    <section id="connect-panel" class="workflow-card is-active" data-step="1" aria-current="step"><div class="card-heading"><span class="step-badge">1</span><div><div class="title-row"><h2>Connect GitHub</h2><span class="step-state" role="status">Ready</span></div><p id="connect-description"><span id="connect-status" role="status">${authenticated ? 'Loading your GitHub profile and repository owners…' : 'Connect first to choose a repository owner and fill in your author name.'}</span>${publicWeb && authenticated ? ' <button id="logout" class="inline-action" type="button">Click here to sign out.</button>' : ''}</p></div></div>
      <div id="connect-actions" class="card-body">
      ${publicWeb ? '<a id="connect-button" class="button button-primary" href="/auth/login">Connect with GitHub</a><p class="permission-copy">Uses your profile, organization membership, repository, and workflow permissions. Grant organization access only where you want to create packages.</p>' : '<p>Start the local Web with <code>pkgfactory web --gh</code>, <code>--device</code>, or a configured <code>GITHUB_TOKEN</code>.</p>'}
      <button id="retry-profile" type="button" class="button button-secondary" ${authenticated ? '' : 'hidden'}>Retry account lookup</button>
      <div id="connect-error" class="notice notice-error" role="alert" hidden></div></div>
    </section>
    <form id="package-form" class="package-flow" hidden>
      <fieldset id="package-fields" class="package-flow" aria-label="Package settings">
        <section class="workflow-card" data-step="2"><div class="card-heading"><span class="step-badge">2</span><div><div class="title-row"><h2>Create repository</h2><span class="step-state" role="status">Upcoming</span></div><p>Choose where the repository will live and give your package its Julia name.</p></div></div>
          <div class="card-body field-grid two-columns">
            <label class="field"><span>Repository owner</span><select id="owner" name="owner" required aria-describedby="owner-help"></select><small id="owner-help">Your account and organizations where you are an owner. Missing an organization? Check its access in GitHub's PkgFactory authorization settings.</small></label>
            <label class="field"><span>Visibility</span><select id="visibility" name="visibility"><option value="public">Public</option><option value="private">Private</option></select></label>
            <label class="field full-width"><span>Package name</span><div class="input-suffix"><input id="package-name" name="name" autocomplete="off" placeholder="MyPkg" pattern="[A-Z][A-Za-z0-9]*(\\.jl)?" maxlength="100" required aria-describedby="package-availability"><span>.jl</span></div><small>Start with A–Z; use letters and digits. The repository gets a .jl suffix.</small><small id="package-availability" class="availability-status" role="status" aria-live="polite"></small></label>
          </div>
        </section>
        <section class="workflow-card" data-step="3"><div class="card-heading"><span class="step-badge">3</span><div><div class="title-row"><h2 tabindex="-1">Generate package template</h2><span class="step-state" role="status">Upcoming</span></div><p>Select the starter files and metadata for the initial package commit.</p></div></div><div class="card-body">
          <label class="field"><span>Authors</span><textarea id="authors" name="authors" required rows="2" maxlength="4000" aria-describedby="authors-help"></textarea><small id="authors-help">Filled from your GitHub profile. Use one author per line; commas and semicolons become line breaks.</small></label>
          <label class="field"><span>Description</span><textarea id="description" name="description" maxlength="2000" rows="2" placeholder="A concise description of what this package does."></textarea></label>
          <label class="field"><span>Template</span><select id="template" name="template" required aria-describedby="template-help"><option value="" disabled selected>Select a template…</option><option value="all-in-one">All-in-one · Quality checks, documentation, and examples</option><option value="simple">Simple · Documentation and releases</option><option value="minimum">Minimum · Package and tests</option></select><small id="template-help">Selecting a template moves to Configure automation once the package details are complete.</small></label>
        </div></section>
        <section class="workflow-card" data-step="4"><div class="card-heading"><span class="step-badge">4</span><div><div class="title-row"><h2 tabindex="-1">Configure automation</h2><span class="step-state" role="status">Upcoming</span></div><p id="automation-description">Documenter and TagBot are configured automatically.</p></div></div><div class="card-body">
          <div id="documenter-row" class="automation-row"><div class="automation-copy"><strong>Documenter deployment</strong><small id="documenter-detail">Select Simple or All-in-one to include documentation deployment.</small></div><span id="documenter-state" class="app-state">Choose a template</span></div>
          ${githubAppRow('codecov', 'Codecov', 'Coverage reports and pull request checks. Uploads use GitHub OIDC; no upload token is required.')}
          ${githubAppRow('juliaregistrator', 'Registrator', "For publishing a public package to Julia’s General registry when it is ready. Optional for repository creation.")}
          <p id="apps-help" class="permission-copy">Apps can be configured after creation. If access is limited to selected repositories, add the new repository on GitHub.</p>
          <button id="refresh-apps" class="inline-action" type="button">Refresh app status</button>
          <p class="permission-copy">Your review is prepared automatically after these checks. Optional apps can be installed later.</p>
        </div></section>
      </fieldset>
      <section class="workflow-card create-card" data-step="5"><div class="card-heading"><span class="step-badge">5</span><div><div class="title-row"><h2 tabindex="-1">Review and create</h2><span class="step-state" role="status">Upcoming</span></div><p>Preview the generated files before creating your repository.</p></div></div><div class="card-body">
        <div class="review-status"><span id="review-spinner" class="spinner" aria-hidden="true" hidden></span><p id="review-status" role="status">Complete the package settings to prepare your review automatically.</p><button id="retry-preview" class="inline-action" type="button" hidden>Retry</button></div>
        <div id="review-content" aria-busy="false"><div id="preview" hidden><p id="target"></p><p id="hint"></p><div class="file-preview"><div id="files" role="group" aria-label="Generated files"></div><pre id="content" tabindex="0" aria-label="Selected file content" hidden></pre></div>
          <label class="check-field"><input type="checkbox" id="confirm"><span>I reviewed this preview and want to create this repository.</span></label>
          <button id="create" class="button button-primary" type="button" aria-busy="false" disabled><span id="create-spinner" class="spinner" aria-hidden="true" hidden></span><span id="create-label">Create repository</span></button>
          <div id="creation-progress" class="creation-progress" hidden><div class="progress-heading"><p role="status">Creating your repository and configuring GitHub automation…</p><span id="creation-elapsed" aria-live="off"></span></div><div class="progress-track" role="progressbar" aria-label="Repository creation in progress"><span></span></div><p>Keep this page open. This can take a little while.</p></div>
          <div id="creation-error" class="notice notice-error" role="alert" hidden></div>
        </div></div>
      </div></section>
      <section class="workflow-card" data-step="6"><div class="card-heading"><span class="step-badge">6</span><div><div class="title-row"><h2 tabindex="-1">Use your package</h2><span class="step-state" role="status">Upcoming</span></div><p>Open your repository and take the next steps.</p></div></div><div class="card-body">
        <p id="success-placeholder" class="permission-copy">Your repository link and next steps will appear here after creation.</p>
        <div id="success-panel" class="creation-result" hidden><p id="success-copy" role="status"></p><div class="success-actions"><a id="repository-link" class="button button-success" target="_blank" rel="noreferrer">Go to repository</a><button id="create-another" class="button button-secondary" type="button">Create another package</button></div>
          <section id="registration-guide" class="registration-guide"><h3>Publish to Julia's General registry</h3><p>When your public package is ready, follow the <a href="https://github.com/JuliaRegistries/General#registering-a-package-in-general" target="_blank" rel="noreferrer">General registration guidelines</a> to publish your first version.</p></section>
        </div>
      </div></section>
    </form>
    <output id="result" role="status" aria-live="polite"></output>
  </div></main><footer class="app-footer"><span>PkgFactory</span><span>Julia package scaffolding through the GitHub API</span></footer></body></html>`;
}

function githubAppRow(slug: string, name: string, description: string) {
  return `<div id="${slug}-row" class="automation-row"><div class="automation-copy"><strong>${name} GitHub App</strong><small id="${slug}-description">${description}</small><small id="${slug}-detail" role="status">Check installation and repository access on GitHub.</small><a href="https://github.com/apps/${slug}" target="_blank" rel="noreferrer">Install or configure ${name}</a><label id="${slug}-confirmation" class="check-field app-confirmation"><input id="${slug}-confirmed" type="checkbox"><span>I confirmed ${name} is installed for this owner.</span></label></div><span id="${slug}-state" class="app-state">Check on GitHub</span></div>`;
}
