export type StepState = 'upcoming' | 'ready' | 'complete';

// A later step cannot be complete while an earlier step still needs attention.
export function workflowStates(completed: readonly boolean[]): StepState[] {
  let next = true;
  return completed.map(done => {
    if (!next) return 'upcoming';
    if (done) return 'complete';
    next = false;
    return 'ready';
  });
}

export function normalizeAuthorSeparators(value: string): string {
  return value.replace(/[,;，；]/g, '\n');
}

export function parseAuthors(value: string): string[] {
  return normalizeAuthorSeparators(value).split(/\r?\n/).map(author => author.trim()).filter(Boolean);
}
