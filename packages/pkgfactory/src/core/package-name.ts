// Naming policy from PkgFactory.jl/src/verification.jl at 6cf2962.
// Test for an actual lowercase letter: all-uppercase checks miss names with digits.
export function packageNameError(name: string): string {
  if (!name) return 'Enter a package name.';
  if (name.endsWith('.jl')) return 'Remove the .jl suffix; it is added automatically to the repository name.';
  if (name.length > 100) return 'Use at most 100 characters for the package name.';
  if (!/^[A-Z]/.test(name)) return 'Start the package name with an uppercase ASCII letter (A–Z).';
  if (/[_-]/.test(name)) return 'Use upper camel case without underscores or hyphens.';
  if (!/^[A-Za-z0-9]+$/.test(name)) return 'Use only ASCII letters and digits; spaces and symbols are not allowed.';
  if (name.includes('Julia') || name.includes('julia')) return 'The package name must not contain “Julia” or “julia”.';
  if (name.startsWith('Ju')) return 'The package name must not start with “Ju”.';
  if (!/[a-z]/.test(name)) return 'Include at least one lowercase letter (a–z).';
  if (name.length < 5) return 'Use at least 5 characters for the package name.';
  if (name.endsWith('jl')) return 'The package name must not end with “jl”.';
  return '';
}
