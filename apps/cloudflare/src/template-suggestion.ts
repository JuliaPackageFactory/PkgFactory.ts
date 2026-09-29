import { FactoryError } from '../../../packages/pkgfactory/src/application/engine.js';
import { listTemplates, specSchema, type PackageSpec } from '../../../packages/pkgfactory/src/core/spec.js';

const inputSchema = specSchema.pick({description: true});
// Describe when each existing bundle is useful, without inventing domain-specific files.
const useCases: Record<PackageSpec['template'], string> = {
  minimum: 'For a small utility, learning exercise, experiment, or prototype that only needs the essential package structure and tests, without a documentation website or release automation.',
  simple: 'For a reusable Julia library with a documented public API, a documentation website, and automated releases, without additional research examples or extensive quality tooling.',
  'all-in-one': 'For a scientific or numerical computing library, research software, simulations, or a substantial shared package that benefits from citations, notebook examples, documentation, and additional quality checks.',
};

export async function suggestTemplate(ai: Pick<Ai, 'run'> | undefined, input: unknown) {
  const description = inputSchema.parse(input).description.trim();
  if (!description) return {template: null};
  if (!ai) throw new FactoryError('suggestion_unavailable', 'Template suggestions are temporarily unavailable.', 503);
  const candidates = listTemplates();
  const inputs = {query: description, top_k: 1,
    contexts: candidates.map(candidate => ({text: `${candidate.id}: ${candidate.description}. ${useCases[candidate.id]}`}))};
  try {
    const result = await ai.run('@cf/baai/bge-reranker-base', inputs);
    const best = result.response?.[0];
    if (!best || !Number.isInteger(best.id) || typeof best.score !== 'number' || !Number.isFinite(best.score) || !candidates[best.id!]) throw new Error('Invalid ranking');
    return {template: candidates[best.id!].id};
  } catch {
    // Do not expose upstream details or prevent manual template selection.
    throw new FactoryError('suggestion_unavailable', 'Template suggestions are temporarily unavailable.', 502);
  }
}
