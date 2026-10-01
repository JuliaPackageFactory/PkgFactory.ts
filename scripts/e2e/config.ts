import { templates, type PackageSpec } from '../../packages/pkgfactory/src/core/spec.js';

export const sourceRepository = 'JuliaPackageFactory/PkgFactory.ts';
export const targets = [
  {name: 'ExampleMinimum', template: 'minimum', previousNames: ['TestMinimum', 'TemplateMinimum', 'PkgFactoryMinimum']},
  {name: 'ExampleSimple', template: 'simple', previousNames: ['TestSimple', 'TemplateSimple', 'PkgFactorySimple']},
  {name: 'ExampleAllInOne', template: 'all-in-one', previousNames: ['TestAllInOne', 'TemplateAllInOne', 'TamplateAllInOne', 'PkgFactoryAllInOne']},
] as const;
export type Target = typeof targets[number];
export function snapshotTarget(name: string): Target {
  const target = targets.find(t => t.name === name);
  if (!target) throw new Error('Choose ExampleMinimum, ExampleSimple, or ExampleAllInOne');
  return target;
}
export function selectedTemplate(args: string[]): PackageSpec['template'] {
  const values = args.filter(a => a.startsWith('--template='));
  const value = values[0]?.slice('--template='.length) ?? 'simple';
  if (values.length > 1 || !templates.includes(value as PackageSpec['template'])) throw new Error('Choose one --template=minimum|simple|all-in-one');
  return value as PackageSpec['template'];
}
export function freshTestName(date = new Date()): string {
  return `Test${date.toISOString().replace(/\D/g, '').slice(0, 14)}`;
}
export function assertFreshTestRepository(repository: string): void {
  if (!/^JuliaPackageFactory\/Test\d{14}\.jl$/.test(repository)) throw new Error('Expected JuliaPackageFactory/TestYYYYMMDDHHMMSS.jl');
}

// Shared by Node and public MCP acceptance. A failed/uncertain call consumes the
// only attempt too: the next operation must inspect and explicitly resume it.
export class SingleCreation {
  private attempted = false;
  async run<T>(repository: string, create: () => Promise<T>): Promise<T> {
    assertFreshTestRepository(repository);
    if (this.attempted) throw new Error('Only one new repository is allowed per acceptance run');
    this.attempted = true;
    return create();
  }
}
