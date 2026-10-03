import { escapeHtml } from './http.js';

// Workflow and styling adapted from PkgFactory.jl at 7c7d4af. Authentication
// uses the agreed server-side session and PKCE instead of tab-held tokens.
export function page(csrf: string, publicWeb: boolean, authenticated: boolean, origin: string, templateSuggestions = false) {
  const pageUrl = escapeHtml(new URL('/', origin).href);
  const imageUrl = escapeHtml(new URL('/assets/ogp.png', origin).href);
  const description = 'Create a Julia package repository and set up its infrastructure from a package name and GitHub username. Use Julia Package Factory through the CLI, Web UI, or MCP.';
  return `<!doctype html><html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="csrf-token" content="${escapeHtml(csrf)}">
  <title>Julia Package Factory</title>
  <meta name="description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Julia Package Factory">
  <meta property="og:title" content="Julia Package Factory">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1280">
  <meta property="og:image:height" content="640">
  <meta property="og:image:alt" content="Julia Package Factory — colorful packages on a factory conveyor belt">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@ohnolab">
  <meta name="twitter:title" content="Julia Package Factory">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${imageUrl}">
  <meta name="twitter:image:alt" content="Julia Package Factory — colorful packages on a factory conveyor belt">
  <link rel="icon" type="image/svg+xml" href="/assets/logo.svg"><link rel="stylesheet" href="/style.css"><script src="/app.js" defer></script>
  </head><body data-authenticated="${authenticated}" data-template-suggestions="${templateSuggestions}">
  <header class="app-header"><div class="header-inner">
    <a class="brand" href="/" aria-label="Julia Package Factory home"><img class="brand-logo" src="/assets/logo.svg" width="42" height="42" alt=""><span>Julia Package Factory</span></a>
    <div class="header-actions">
    <a class="github-link" href="https://github.com/JuliaPackageFactory/PkgFactory.ts" target="_blank" rel="noreferrer" aria-label="View PkgFactory on GitHub" title="View PkgFactory on GitHub"><img src="/assets/github.svg" width="30" height="30" alt=""></a></div>
  </div></header>
  <main class="main-content"><div id="reconnect-notice" class="notice notice-error" role="alert" hidden>GitHub authorization has expired or changed. ${publicWeb ? '<a id="reconnect" href="/auth/login">Reconnect GitHub</a> to continue with your settings.' : 'Restart the local Web with a valid GitHub credential.'}</div><section class="intro" aria-labelledby="page-title"><p class="eyebrow">JULIA PACKAGE FACTORY</p><h1 id="page-title">Let's generate a Julia package!</h1>
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
        <section class="workflow-card" data-step="2"><div class="card-heading"><span class="step-badge">2</span><div><div class="title-row"><h2 tabindex="-1">Repository settings</h2><span class="step-state" role="status">Upcoming</span></div><p>Choose where the repository will live and give your package its Julia name.</p></div></div>
          <div class="card-body field-grid two-columns">
            <label class="field"><span>Repository owner</span><select id="owner" name="owner" required aria-describedby="owner-help"></select><small id="owner-help">Your account and organizations where you are an owner. Missing an organization? Check its access in GitHub's PkgFactory authorization settings.</small></label>
            <label class="field"><span>Visibility</span><select id="visibility" name="visibility" aria-describedby="private-docs-help"><option value="public">Public</option><option value="private">Private</option></select><small id="private-docs-help" hidden>Documenter uses GitHub Pages. Private repositories require a supported paid plan, and the documentation site may still be public. <a href="https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site" target="_blank" rel="noreferrer">Check GitHub Pages availability and visibility</a>.</small></label>
            <label class="field full-width"><span>Package name</span><div class="input-suffix"><input id="package-name" name="name" autocomplete="off" placeholder="MyPkg" maxlength="100" required aria-describedby="package-availability"><span>.jl</span></div><small id="package-availability" class="availability-status" role="status" aria-live="polite"></small></label>
          </div>
        </section>
        <section class="workflow-card" data-step="3"><div class="card-heading"><span class="step-badge">3</span><div><div class="title-row"><h2 tabindex="-1">Package details</h2><span class="step-state" role="status">Upcoming</span></div><p>Select the starter files and metadata for the initial package commit.</p></div></div><div class="card-body">
          <label class="field"><span>Authors</span><textarea id="authors" name="authors" required rows="2" maxlength="4000" aria-describedby="authors-help authors-error"></textarea><small id="authors-help">Filled from your GitHub profile. Use one author per line; commas and semicolons become line breaks.</small><small id="authors-error" class="field-error" role="alert" hidden></small></label>
          <label class="field"><span>Description</span><textarea id="description" name="description" maxlength="2000" rows="2" placeholder="A concise description of what this package does." aria-describedby="template-suggestion"></textarea><small id="template-suggestion" role="status" aria-live="polite" hidden><span id="suggestion-spinner" class="spinner" aria-hidden="true" hidden></span><span id="suggestion-message"></span></small></label>
          <label class="field"><span>Template</span><select id="template" name="template" required aria-describedby="template-help"><option value="" disabled selected>Select a template…</option><option value="all-in-one">All-in-one · Quality checks, documentation, and examples</option><option value="simple">Simple · Documentation and releases</option><option value="minimum">Minimum · Package and tests</option></select><small id="template-help">Complete these settings to prepare your review automatically.</small></label>
        </div></section>
        <section class="workflow-card" data-step="4"><div class="card-heading"><span class="step-badge">4</span><div><div class="title-row"><h2 tabindex="-1">Configure automation</h2><span class="step-state" role="status">Upcoming</span></div><p id="automation-description">Documenter and TagBot are configured automatically.</p></div></div><div class="card-body">
          <div id="documenter-row" class="automation-row"><div class="automation-copy"><strong>Documenter deployment</strong><small id="documenter-detail">Select Simple or All-in-one to include documentation deployment.</small></div><span id="documenter-state" class="app-state">Choose a template</span></div>
          <div id="tagbot-row" class="automation-row"><div class="automation-copy"><strong>TagBot releases</strong><small id="tagbot-detail">Select Simple or All-in-one to include release automation.</small></div><span id="tagbot-state" class="app-state">Choose a template</span></div>
          ${githubAppRow('codecov', 'Codecov', 'Coverage reports and pull request checks. Uploads use GitHub OIDC; no upload token is required.')}
          <p id="apps-help" class="permission-copy">Confirm Codecov is installed for this owner to continue. If access is limited to selected repositories, add the new repository after creation.</p>
          <p class="permission-copy">Your review is prepared automatically when these settings are complete.</p>
        </div></section>
      </fieldset>
      <section class="workflow-card create-card" data-step="5"><div class="card-heading"><span class="step-badge">5</span><div><div class="title-row"><h2 tabindex="-1">Review and create</h2><span class="step-state" role="status">Upcoming</span></div><p>Preview the generated files before creating your repository.</p></div></div><div class="card-body">
        <div class="review-status"><span id="review-spinner" class="spinner" aria-hidden="true" hidden></span><p id="review-status" role="status">Complete the package settings to prepare your review automatically.</p><button id="retry-preview" class="inline-action" type="button" hidden>Retry</button></div>
        <div id="review-content" aria-busy="false"><div id="preview" hidden><p id="target"></p><p id="hint"></p><div class="file-preview"><div id="files" role="group" aria-label="Generated files"></div><pre id="content" tabindex="0" aria-label="Selected file content" hidden></pre></div>
          <label class="check-field"><input type="checkbox" id="confirm"><span>I reviewed this preview and want to create this repository.</span></label>
          <button id="create" class="button button-primary" type="button" aria-busy="false" disabled><span id="create-spinner" class="spinner" aria-hidden="true" hidden></span><span id="create-label">Create repository</span></button>
          <div id="creation-progress" class="creation-progress" hidden><div class="progress-heading"><p role="status">Creating your repository and configuring GitHub automation…</p><span id="creation-elapsed" aria-live="off"></span></div><div class="progress-track" role="progressbar" aria-label="Repository creation in progress"><span></span></div><p>Keep this page open. This can take a little while.</p></div>
          <div id="creation-error" class="notice notice-error" role="alert" hidden></div><p id="creation-recovery" class="permission-copy" hidden>Setup may have made changes on GitHub. Creation is paused to avoid repeating them. <a id="interrupted-repository-link" target="_blank" rel="noreferrer">Check the repository</a> before starting another setup.</p>
        </div></div>
      </div></section>
      <section class="workflow-card" data-step="6"><div class="card-heading"><span class="step-badge">6</span><div><div class="title-row"><h2 tabindex="-1">Next steps</h2><span class="step-state" role="status">Upcoming</span></div><p>Open your repository and take the next steps.</p></div></div><div class="card-body">
        <p id="success-placeholder" class="permission-copy">Your repository link and next steps will appear here after creation.</p>
        <div id="success-panel" class="creation-result" hidden><p id="success-copy" role="status"></p><div class="success-actions"><a id="repository-link" class="button button-success" target="_blank" rel="noreferrer">Go to repository</a><button id="create-another" class="button button-secondary" type="button">Create another package</button></div>
          <p id="next-steps">Follow the builds in <a id="actions-link" target="_blank" rel="noreferrer">GitHub Actions</a><span id="documentation-followup" hidden> and <a id="documentation-link" target="_blank" rel="noreferrer">check documentation deployment</a></span>.<span id="codecov-followup" hidden> Ensure <a href="https://github.com/apps/codecov" target="_blank" rel="noreferrer">Codecov can access this repository</a>.</span><span id="registration-guide"> If you wish to register your package in <a href="https://github.com/JuliaRegistries/General" target="_blank" rel="noreferrer">Julia’s General registry</a>, a separate <a href="https://github.com/JuliaRegistries/General#registering-a-package-in-general" target="_blank" rel="noreferrer">registration process</a> is required.</span></p>
        </div>
      </div></section>
    </form>
    <output id="result" role="status" aria-live="polite"></output>
  </div></main><footer class="app-footer"><a href="https://github.com/JuliaPackageFactory/" target="_blank" rel="noreferrer">@JuliaPackageFactory</a><span>© 2026 <a href="https://github.com/ohno" target="_blank" rel="noreferrer">Shuhei Ohno</a></span></footer></body></html>`;
}

function githubAppRow(slug: string, name: string, description: string) {
  return `<div id="${slug}-row" class="automation-row"><div class="automation-copy"><strong>${name} GitHub App</strong><small id="${slug}-description">${description}</small><small id="${slug}-detail" role="status">Check installation and repository access on GitHub.</small><a id="${slug}-link" href="https://github.com/apps/${slug}" target="_blank" rel="noreferrer">Install or configure ${name}</a><label id="${slug}-confirmation" class="check-field app-confirmation"><input id="${slug}-confirmed" type="checkbox"><span>I confirmed ${name} is installed for this owner.</span></label></div><span id="${slug}-state" class="app-state">Check on GitHub</span></div>`;
}
