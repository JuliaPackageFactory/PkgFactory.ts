import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releaseRevision} from '../scripts/release-revision.ts';

const repository = 'JuliaPackageFactory/PkgFactory.ts';
function fixture() {
  const run = {id: 123, run_attempt: 2, path: '.github/workflows/ci.yml', event: 'push', head_branch: 'main', head_sha: 'a'.repeat(40), status: 'completed', conclusion: 'success', repository: {full_name: repository}, head_repository: {full_name: repository}};
  const step = (name: string) => ({name, status: 'completed', conclusion: 'success'});
  const job = {...step('Deploy staging'), steps: [step('Deploy tested revision'), step('Check staging health')]};
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); requests.push(url);
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.method ?? 'GET', 'GET');
    if (url.includes('/actions/workflows/ci.yml/runs?')) {
      assert.equal(new URL(url).searchParams.get('head_sha'), 'a'.repeat(40));
      return Response.json({total_count: 1, workflow_runs: [run]});
    }
    assert.match(url, /\/attempts\/2\/jobs\?per_page=100&page=1$/);
    return Response.json({total_count: 1, jobs: [job]});
  };
  return {run, job, requests, options: {repository, sha: run.head_sha, token: 'test-only', fetcher}};
}

test('production automatically verifies its main SHA, including a successful staging rerun', async () => {
  for (const event of ['push', 'workflow_dispatch']) {
    const {options, requests, run} = fixture(); run.event = event;
    assert.deepEqual(await releaseRevision(options), {sha: run.head_sha, runId: '123', attempt: 2});
    assert.equal(requests.length, 2);
  }
});

test('deployment verification reads CI and job pages from the matching commit and attempt', async () => {
  const {run, job, options} = fixture();
  const fetcher: typeof fetch = async input => {
    const url = String(input);
    if (url.includes('/actions/workflows/ci.yml/runs?')) {
      const runs = url.endsWith('page=1') ? [{...run, conclusion: 'failure'}] : [run];
      return Response.json({total_count: 2, workflow_runs: runs});
    }
    assert.match(url, /\/attempts\/2\/jobs/);
    const jobs = url.endsWith('page=1') ? [{...job, name: 'node (ubuntu-latest)'}] : [job];
    return Response.json({total_count: 2, jobs});
  };
  assert.equal((await releaseRevision({...options, fetcher})).sha, run.head_sha);
});

test('production rejects failed/incomplete CI, PRs, forks, other workflows and invalid commits', async () => {
  const changes = [
    {conclusion: 'failure'}, {status: 'in_progress'}, {event: 'pull_request'}, {head_branch: 'feature'},
    {path: '.github/workflows/release.yml'}, {head_sha: 'main'}, {head_sha: 'b'.repeat(40)}, {run_attempt: 0},
    {repository: {full_name: 'other/repo'}}, {head_repository: {full_name: 'other/repo'}},
  ];
  for (const change of changes) {
    const {run, options, requests} = fixture(); Object.assign(run, change);
    await assert.rejects(releaseRevision(options), /has not successfully deployed/);
    assert.equal(requests.length, 1);
  }
});

test('a successful CI with skipped deployment or missing/failed health check cannot be promoted', async () => {
  for (const change of ['job-skipped', 'deploy-skipped', 'health-failed', 'health-missing']) {
    const {job, options} = fixture();
    if (change === 'job-skipped') job.conclusion = 'skipped';
    if (change === 'deploy-skipped') job.steps[0].conclusion = 'skipped';
    if (change === 'health-failed') job.steps[1].conclusion = 'failure';
    if (change === 'health-missing') job.steps.pop();
    await assert.rejects(releaseRevision(options), /has not successfully deployed/);
  }
});

test('invalid SHAs and missing tokens fail before any API request; API failure cannot approve production', async () => {
  const {options, requests} = fixture();
  for (const sha of ['', 'main', 'a'.repeat(40) + '\n', '../123']) {
    await assert.rejects(releaseRevision({...options, sha}), /commit SHA/);
  }
  await assert.rejects(releaseRevision({...options, token: ''}), /token is missing/);
  assert.equal(requests.length, 0);
  await assert.rejects(releaseRevision({...options, fetcher: async () => new Response('private detail', {status: 403})}), /HTTP 403/);
});

test('a later failed run does not hide a successful deployment of the same main commit', async () => {
  const {options, run} = fixture();
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).includes('/actions/workflows/ci.yml/runs?')) {
      return Response.json({total_count: 2, workflow_runs: [{...run, id: 124, conclusion: 'failure'}, run]});
    }
    return options.fetcher(input, init);
  };
  assert.equal((await releaseRevision({...options, fetcher})).sha, options.sha);
});

test('a main commit with no staging CI cannot be deployed to production', async () => {
  const {options} = fixture();
  await assert.rejects(releaseRevision({...options, fetcher: async () => Response.json({total_count: 0, workflow_runs: []})}), /has not successfully deployed/);
});
