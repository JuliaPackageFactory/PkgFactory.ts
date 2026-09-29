import { z } from 'zod';
import { packageNameError } from './package-name.js';
export const templates = ['minimum', 'simple', 'all-in-one'] as const;
const text = (max: number) => z.string().trim().min(1).max(max).refine(s => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s), 'Control characters are not allowed');
export const specSchema = z.object({
  owner: text(39).refine(s => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(s), 'Invalid GitHub owner'),
  // Programmatic callers retain the existing optional repository suffix.
  name: z.string().trim().max(100, 'Use at most 100 characters for the package name, including any .jl suffix.').transform(s => s.replace(/\.jl$/, '')).superRefine((name, ctx) => {
    const message = packageNameError(name);
    if (message) ctx.addIssue({code: 'custom', message});
  }),
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
