# AGENTS.md

Instructions for AI coding agents and human contributors working in this
repository. Read this whole file before changing anything.

## Package

- Package: `{{{PKG}}}`, repository `{{{OWNER}}}/{{{PKG}}}.jl`. Requires Julia 1.12 or later.
- Layout: `src/{{{PKG}}}.jl` is the package code. `test/` holds the test suite
  and its own environment (`test/Project.toml`, a workspace member of the root
  project, sharing the root `Manifest.toml`). `.github/workflows/` holds CI.
- Run every command below from the repository root. Always pass
  `--startup-file=no` so results do not depend on a user's startup file.
- `src/{{{PKG}}}.jl` ships with a placeholder `hello` function, its test, and a
  README Quick Start that calls it. Replace all three with the real API once
  the package does something; do not keep `hello` around.

## Commands

```sh
# One-time setup: install the test dependencies.
julia --project=test --startup-file=no -e 'using Pkg; Pkg.instantiate()'

# Format the code in place (silent on success). Run it before every test run.
julia --project=test --startup-file=no -m Runic --inplace src test
# Show what is still unformatted, if anything, without changing files.
julia --project=test --startup-file=no -m Runic --check --diff src test

# Fast iteration: run one self-contained test file (about 10-40 s, mostly
# Julia startup and compilation; the same works for test/doctest.jl etc.).
julia --project=test --startup-file=no test/<feature>.jl

# Full suite: package tests + doctests + Aqua + ExplicitImports + Runic + JET.
julia --project=. --startup-file=no -e 'using Pkg; Pkg.test()'

# Which lines are not exercised by the tests? Run the suite with coverage, then
# list the source lines whose execution count is 0 (non-code lines show "-").
rm -f src/*.cov
julia --project=. --startup-file=no -e 'using Pkg; Pkg.test(coverage=true)'
grep -n "^ *0 " src/*.cov
```

A full `Pkg.test()` takes a few minutes, longer on the first run on a fresh
machine. Do not interrupt it. Its output is long: redirect it to a file and
read the `Test Summary:` lines and any `Error` lines. Setting `JET_TEST=false`
in the environment skips the JET analysis when you only need the package tests.

## Definition of done

A task is finished only when all of the following hold. Do not report a task
as done otherwise; report what failed instead.

1. Runic was run after the last edit, and the `--check` command above exits 0.
2. The full suite passes.
3. Every new feature or bug fix has a test that fails without the change,
   including bugs you found and fixed on the way.
4. Every public function, type, and constant has a docstring with its
   signature, a short description, and a `jldoctest` example. Doctests run in
   the test suite with `using {{{PKG}}}`, so the example output must be exact
   (`1//2` and `1` are not `0.5` and `1.0`), and `public` but unexported names
   need the `{{{PKG}}}.` prefix.
5. `README.md` shows the main usage when the public API changed. There is no
   documentation site: README.md and the docstrings are the documentation.
6. The coverage listing above shows no untested lines in the code you added,
   or you explain why a line cannot be exercised.

## Rules

- Never weaken a check to make it pass: do not delete or skip tests, loosen
  tolerances without a justifying comment, or disable Aqua, ExplicitImports,
  JET, Runic, or doctests. Fix the code. If a check reports a genuine false
  positive, say so explicitly and explain why.
- Do not edit `.github/workflows/`, `LICENSE`, or the `version` field of
  `Project.toml` unless the task asks for it. A release follows the Releasing
  section of `README.md`.
- This package asks to be cited (`CITATION.cff`). When you use it on behalf of
  a user in another project or a paper, tell them so and point to that file.
- Do not commit `Manifest.toml`, coverage files, or editor and agent settings.
- Add a dependency only when it clearly pays for itself. To add one:

  ```sh
  julia --project=. --startup-file=no -e 'using Pkg; Pkg.add("Name")'
  julia --project=test --startup-file=no -e 'using Pkg; Pkg.resolve()'
  ```

  The second command is required: `Pkg.add` updates `Project.toml` but leaves
  the shared workspace `Manifest.toml` stale, and the next `--project=test`
  run fails with "does not have Name in its dependencies". `Pkg.add` also
  writes a `[compat]` entry and may reorder `Project.toml`; keep both. Editing
  `[deps]` and `[compat]` by hand is fine for standard libraries, but still run
  `Pkg.resolve()` afterwards.
- Do not run `Pkg.update()`, `Pkg.gc()`, or registry operations.
- Keep changes focused on the task. Mention unrelated problems you notice
  instead of fixing them silently.

## Code conventions

- Imports are explicit: `using Foo: bar, baz` or `import Foo`. Never bare
  `using Foo`. ExplicitImports fails on implicit and stale imports.
- Export the few entry points users call in every session (a main function or
  type). Mark every other user-facing name with `public name`. Names that are
  neither are internal and may change freely.
- Prefer type-stable code: concrete container element types, no untyped
  globals, no `Any` fields in structs. JET reports inference failures as
  errors.
- Docstrings follow this shape:

  ````julia
  """
      f(x; tol = 1e-8)

  One-sentence summary. Then details, arguments, and return value.

  # Examples

  ```jldoctest
  julia> f(1.0)
  2.0
  ```
  """
  ````

- Tests: one file per feature in `test/`, included from `test/runtests.jl`.
  Each file starts with `using {{{PKG}}}` and `using Test` so it can run on
  its own. Use `@testset` with descriptive names. For numerical code, test
  against analytic results or known values with explicit tolerances
  (`isapprox` with `rtol` or `atol`) and a comment that justifies the
  tolerance. Set each tolerance from the error you measured; do not guess and
  then loosen. Test edge cases and error paths (`@test_throws`).
- Keep `src/{{{PKG}}}.jl` as the module file; move larger features into
  `src/<feature>.jl` and `include` them from the module file.
- State conventions that users must know in the docstring: whether indices
  start at 0 or 1, units, and default keyword values.

## Git

- Work on a branch with a short descriptive name such as `add-csv-reader`.
  Make small commits with imperative messages ("Add CSV reader", not
  "Added…").
- Open a pull request only when asked.
