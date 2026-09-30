import { z } from 'zod';
import { FactoryError } from '../../../packages/pkgfactory/src/application/engine.js';
import { listTemplates, specSchema, templates, type PackageSpec } from '../../../packages/pkgfactory/src/core/spec.js';

const inputSchema = specSchema.pick({description: true});
const resultSchema = z.object({answers: z.object({template: z.object({type: z.literal('choice'), choice: z.enum(templates)})})});
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
  const inputs = {state: description, questions: {template: {
    type: 'choice',
    instructions: 'Which Julia package template best fits the package described in the state?',
    criteria: Object.fromEntries(candidates.map(candidate => [candidate.id, `${candidate.description}. ${useCases[candidate.id]}`])),
  }}};
  try {
    // Third-party models use AI Gateway's Unified Billing through the existing binding.
    const result = await ai.run('typesafe/jev', inputs, {gateway: {id: 'default', collectLog: false}});
    return {template: resultSchema.parse(result).answers.template.choice};
  } catch {
    // Do not expose upstream details or prevent manual template selection.
    throw new FactoryError('suggestion_unavailable', 'Template suggestions are temporarily unavailable.', 502);
  }
}
