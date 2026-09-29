import {appendFile} from 'node:fs/promises';

interface Run {
  id: number; run_attempt: number; path: string; event: string; head_branch: string; head_sha: string;
  status: string; conclusion: string | null;
  repository: {full_name: string}; head_repository: {full_name: string};
}
interface Job {
  name: string; status: string; conclusion: string | null;
  steps: {name: string; status: string; conclusion: string | null}[];
}
interface Options {repository: string; runId: string; token: string; fetcher?: typeof fetch}

/** Resolve only a successful, actually deployed staging CI attempt, never a PR or a skipped deployment. */
export async function releaseRevision({repository, runId, token, fetcher = fetch}: Options) {
  if (repository !== 'JuliaPackageFactory/PkgFactory.ts') throw new Error('Production releases must run in JuliaPackageFactory/PkgFactory.ts.');
  if (!/^[1-9]\d*$/.test(runId) || !Number.isSafeInteger(Number(runId))) throw new Error('Enter the verified staging CI run ID (the number in its /actions/runs/ URL).');
  if (!token) throw new Error('GitHub Actions read token is missing.');
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetcher(`https://api.github.com/repos/${repository}${path}`, {
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'},
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Cannot verify staging CI: GitHub returned HTTP ${response.status}.`);
    return await response.json() as T;
  };
  const run = await get<Run>(`/actions/runs/${runId}`);
  if (String(run.id) !== runId || run.repository?.full_name !== repository || run.head_repository?.full_name !== repository ||
      run.path !== '.github/workflows/ci.yml' || run.head_branch !== 'main' || !['push', 'workflow_dispatch'].includes(run.event) ||
      run.status !== 'completed' || run.conclusion !== 'success' || !/^[0-9a-f]{40}$/.test(run.head_sha) ||
      !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) {
    throw new Error('Choose a successful main CI run from this repository after verifying its staging deployment.');
  }
  const jobs: Job[] = [];
  for (let page = 1; ; page++) {
    const result = await get<{total_count: number; jobs: Job[]}>(`/actions/runs/${runId}/attempts/${run.run_attempt}/jobs?per_page=100&page=${page}`);
    if (!Array.isArray(result.jobs) || !Number.isSafeInteger(result.total_count) || result.total_count < 0) throw new Error('Invalid staging job response.');
    jobs.push(...result.jobs);
    if (jobs.length >= result.total_count) break;
    if (!result.jobs.length) throw new Error('Incomplete staging job response.');
  }
  const deployments = jobs.filter(job => job.name === 'Deploy staging');
  const deployment = deployments[0];
  const success = (step: {status: string; conclusion: string | null}) => step.status === 'completed' && step.conclusion === 'success';
  if (deployments.length !== 1 || !success(deployment) ||
      !['Deploy tested revision', 'Check staging health'].every(name => deployment.steps?.some(step => step.name === name && success(step)))) {
    throw new Error('The selected CI run did not deploy staging and pass its health check. Skipped or failed deployments cannot be promoted.');
  }
  return {sha: run.head_sha, runId, attempt: run.run_attempt};
}

if (import.meta.main) {
  try {
    const result = await releaseRevision({repository: process.env.GITHUB_REPOSITORY ?? '', runId: process.env.STAGING_RUN_ID ?? '', token: process.env.GH_TOKEN ?? ''});
    if (!process.env.GITHUB_OUTPUT || !process.env.GITHUB_STEP_SUMMARY) throw new Error('GitHub Actions output files are missing.');
    await appendFile(process.env.GITHUB_OUTPUT, `sha=${result.sha}\n`);
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `Production source: [staging CI ${result.runId}, attempt ${result.attempt}](https://github.com/JuliaPackageFactory/PkgFactory.ts/actions/runs/${result.runId}/attempts/${result.attempt})\n\nCommit: \`${result.sha}\`\n`);
    console.log(`Verified staging commit: ${result.sha} (CI ${result.runId}, attempt ${result.attempt})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Cannot verify staging CI.');
    process.exitCode = 1;
  }
}
