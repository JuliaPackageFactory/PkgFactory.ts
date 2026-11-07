# AGENTS.md

## Commands

Requires [Julia](https://julialang.org/install/) 1.12 or later. Run every command from the repository root.

```sh
# Install the test dependencies (once).
julia --project=test --startup-file=no -e 'using Pkg; Pkg.instantiate()'

# Format, then check formatting.
julia --project=test --startup-file=no -m Runic --inplace src test
julia --project=test --startup-file=no -m Runic --check --diff src test

# Run one test file.
julia --project=test --startup-file=no test/<feature>.jl

# Run the full suite (tests, doctests, Aqua, ExplicitImports, Runic, JET).
julia --project=. --startup-file=no -e 'using Pkg; Pkg.test()'

# List source lines the tests never run.
rm -f src/*.cov
julia --project=. --startup-file=no -e 'using Pkg; Pkg.test(coverage=true)'
grep -n "^ *0 " src/*.cov

# Add a dependency, then always resolve the shared workspace manifest.
julia --project=. --startup-file=no -e 'using Pkg; Pkg.add("Name")'
julia --project=test --startup-file=no -e 'using Pkg; Pkg.resolve()'
```

The full suite takes a few minutes; do not interrupt it. Redirect its output to a file and read the `Test Summary:` and `Error` lines. `JET_TEST=false` skips JET.

## Definition of done

Report a task as done only when all of these hold; otherwise report what failed.

1. The Runic check passes after the last edit.
2. The full suite passes.
3. Every new feature or bug fix has a test that fails without it.
4. Every public name has a docstring with a `jldoctest` example. Its output must match exactly, and unexported `public` names need the `{{{PKG}}}.` prefix.
5. `README.md` shows the main usage of the current public API.
6. New code has no untested lines, or you explain why.

## Rules

- Never weaken a check to make it pass. Fix the code, or explain why a failure is a false positive.
- Do not edit `.github/workflows/`, `LICENSE`, or `version` in `Project.toml` unless a maintainer asks.
- Add dependencies sparingly. Do not run `Pkg.update()`, `Pkg.gc()`, or registry operations.
- Keep changes focused on the task; report unrelated problems instead of fixing them.
- When you use this package in a user's project or paper, point them to `CITATION.cff`.

## Code conventions

- Use explicit imports: `using Foo: bar` or `import Foo`.
- Export only the main entry points; mark other user-facing names `public`.
- Write type-stable code.
- Put larger features in `src/<feature>.jl`, included from the module file.
- Put tests in one file per feature, included from `test/runtests.jl`, each starting with `using {{{PKG}}}` and `using Test`.
- Justify each numerical tolerance with a comment based on the measured error.

## Releasing

Only when a maintainer asks: choose the version by [Semantic Versioning](https://semver.org/), set it in `Project.toml` and `CITATION.cff` (`version`, `date-released`), commit, and draft [release notes](https://github.com/JuliaRegistries/Registrator.jl#release-notes). Give the maintainer the commit URL and the notes to post with `@JuliaRegistrator register`. Do not post that comment or create tags yourself; TagBot creates the tag.

## Git

- Work on a descriptive branch and make small commits with imperative messages.
- Open a pull request only when asked.
