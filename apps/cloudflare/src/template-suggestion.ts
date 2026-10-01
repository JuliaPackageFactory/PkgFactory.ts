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

function suggestionError(reason: string, message: string, upstreamStatus?: number) {
  // Keep diagnostics useful without logging descriptions, response bodies, or credentials.
  console.warn(JSON.stringify({event: 'template_suggestion_failed', reason, upstreamStatus}));
  return new FactoryError(`suggestion_${reason}`, `${message} You can choose a template below.`, 502);
}

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
  let response;
  try {
    // Third-party models use AI Gateway's Unified Billing through the existing binding.
    // Read JSON ourselves: the binding otherwise returns a stream for JSON with a charset.
    response = await ai.run('typesafe/jev', inputs, {gateway: {id: 'default', collectLog: false}, returnRawResponse: true});
  } catch {
    throw suggestionError('connection', 'Could not reach Jev.');
  }
  if (!(response instanceof Response)) throw suggestionError('response', 'Jev returned an unexpected response.');
  if (!response.ok) {
    await response.body?.cancel();
    throw suggestionError('upstream', `Jev request failed (HTTP ${response.status}).`, response.status);
  }
  let result;
  try {result = await response.json();}
  catch {throw suggestionError('json', 'Jev returned an unreadable response.', response.status);}
  const parsed = resultSchema.safeParse(result);
  if (!parsed.success) throw suggestionError('response', 'Jev returned an unexpected template choice.', response.status);
  return {template: parsed.data.answers.template.choice};
}
