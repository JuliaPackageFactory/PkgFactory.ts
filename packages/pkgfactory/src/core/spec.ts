import { z } from 'zod';
export const templates = ['minimum', 'simple', 'all-in-one'] as const;
const text = (max: number) => z.string().trim().min(1).max(max).refine(s => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s), 'Control characters are not allowed');
export const specSchema = z.object({
  owner: text(39).refine(s => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(s), 'Invalid GitHub owner'),
  name: text(100).transform(s => s.replace(/\.jl$/, '')).pipe(z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'Use a Julia module name starting with A–Z').refine(s => s !== 'Julia' && !s.endsWith('jl'), 'Invalid Julia package name')),
  authors: z.array(text(200)).min(1).max(20),
  description: z.string().max(2000).default(''),
  template: z.enum(templates).default('simple'),
  visibility: z.enum(['public', 'private']).default('public'),
}).strict();
export type PackageSpec = z.infer<typeof specSchema>;
export const listTemplates = () => templates.map(id => ({id, documentation: id !== 'minimum', description: {
  minimum: 'Package, tests, and CI', simple: 'Package, tests, Documenter, and TagBot',
  'all-in-one': 'Documentation, quality checks, citation, and notebook',
}[id]}));
