import { GitHub } from './client.js';

export const appSlugs = ['codecov', 'juliaregistrator'] as const;
export type AppSlug = typeof appSlugs[number];
export type AppInstallation = {state: 'unknown' | 'not-installed' | 'installed' | 'suspended'; selection?: 'all' | 'selected'};
export type AppInstallations = Record<AppSlug, AppInstallation>;
export const unknownInstallations = (): AppInstallations => ({codecov: {state: 'unknown'}, juliaregistrator: {state: 'unknown'}});

// /user/installations only lists the authenticating GitHub App, not other apps
// installed on a personal account. Organizations have a separate read endpoint.
// https://docs.github.com/en/rest/orgs/orgs#list-app-installations-for-an-organization
export async function organizationInstallations(github: GitHub, owner: string): Promise<AppInstallations> {
  const result: AppInstallations = {codecov: {state: 'not-installed'}, juliaregistrator: {state: 'not-installed'}};
  for (let page = 1; page <= 100; page++) {
    const {installations} = await github.request<{installations: {app_slug: string; suspended_at: string | null; repository_selection: 'all' | 'selected'}[]}>(
      'GET', `/orgs/${encodeURIComponent(owner)}/installations?per_page=100&page=${page}`);
    for (const installation of installations) {
      if (!appSlugs.includes(installation.app_slug as AppSlug)) continue;
      result[installation.app_slug as AppSlug] = {
        state: installation.suspended_at ? 'suspended' : 'installed', selection: installation.repository_selection,
      };
    }
    if (installations.length < 100) return result;
  }
  throw new Error('GitHub pagination exceeded safety limit');
}
