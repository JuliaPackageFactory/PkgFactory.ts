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
interface Options {repository: string; sha: string; token: string; fetcher?: typeof fetch}

/** Check staging deployment history for the main commit captured when production was manually triggered. */
export async function releaseRevision({repository, sha, token, fetcher = fetch}: Options) {
  if (repository !== 'JuliaPackageFactory/PkgFactory.ts') throw new Error('Production releases must run in JuliaPackageFactory/PkgFactory.ts.');
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('The production workflow commit SHA is missing or invalid.');
  if (!token) throw new Error('GitHub Actions read token is missing.');
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetcher(`https://api.github.com/repos/${repository}${path}`, {
      headers: {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'},
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Cannot verify staging CI: GitHub returned HTTP ${response.status}.`);
    return await response.json() as T;
  };
  const success = (step: {status: string; conclusion: string | null}) => step.status === 'completed' && step.conclusion === 'success';
  let seen = 0;
  for (let page = 1; ; page++) {
    const result = await get<{total_count: number; workflow_runs: Run[]}>(`/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=100&page=${page}`);
    if (!Array.isArray(result.workflow_runs) || !Number.isSafeInteger(result.total_count) || result.total_count < 0) throw new Error('Invalid staging CI response.');
    for (const run of result.workflow_runs) {
      if (run.repository?.full_name !== repository || run.head_repository?.full_name !== repository ||
          run.path !== '.github/workflows/ci.yml' || run.head_branch !== 'main' || !['push', 'workflow_dispatch'].includes(run.event) ||
          !success(run) || run.head_sha !== sha || !Number.isSafeInteger(run.id) || run.id < 1 ||
          !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) continue;
      const jobs: Job[] = [];
      for (let jobPage = 1; ; jobPage++) {
        const result = await get<{total_count: number; jobs: Job[]}>(`/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100&page=${jobPage}`);
        if (!Array.isArray(result.jobs) || !Number.isSafeInteger(result.total_count) || result.total_count < 0) throw new Error('Invalid staging job response.');
        jobs.push(...result.jobs);
        if (jobs.length >= result.total_count) break;
        if (!result.jobs.length) throw new Error('Incomplete staging job response.');
      }
      const deployments = jobs.filter(job => job.name === 'Deploy staging');
      const deployment = deployments[0];
      if (deployments.length === 1 && success(deployment) &&
          ['Deploy tested revision', 'Check staging health'].every(name => deployment.steps?.some(step => step.name === name && success(step)))) {
        return {sha, runId: String(run.id), attempt: run.run_attempt};
      }
    }
    seen += result.workflow_runs.length;
    if (seen >= result.total_count) break;
    if (!result.workflow_runs.length) throw new Error('Incomplete staging CI response.');
  }
  throw new Error('This main commit has not successfully deployed to staging. Wait for CI, check staging, then run Deploy production again.');
}

if (import.meta.main) {
  try {
    const result = await releaseRevision({repository: process.env.GITHUB_REPOSITORY ?? '', sha: process.env.GITHUB_SHA ?? '', token: process.env.GH_TOKEN ?? ''});
    if (!process.env.GITHUB_STEP_SUMMARY) throw new Error('GitHub Actions summary file is missing.');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `Production source: [staging CI ${result.runId}, attempt ${result.attempt}](https://github.com/JuliaPackageFactory/PkgFactory.ts/actions/runs/${result.runId}/attempts/${result.attempt})\n\nCommit: \`${result.sha}\`\n`);
    console.log(`Verified staging commit: ${result.sha} (CI ${result.runId}, attempt ${result.attempt})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Cannot verify staging CI.');
    process.exitCode = 1;
  }
}
