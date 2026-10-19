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
- Inside Julia code use relative paths or native paths (`C:\...` on Windows);
  shell-style `/c/...` paths are not understood by Julia.
- All text files use LF line endings (`.gitattributes`, `.editorconfig`). On
  Windows, write files with LF explicitly (for example `newline="\n"` in
  Python); Git warns "CRLF will be replaced by LF" when a tool wrote CRLF.
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

A full `Pkg.test()` takes one to three minutes once the dependencies are
precompiled (Aqua and JET dominate); the very first run on a fresh machine can
take several minutes more because it precompiles JET and Documenter. Do not
interrupt it. Its output is long: redirect it to a file and read the
`Test Summary:` lines and any `Error` lines. Setting `JET_TEST=false` in the
environment skips the JET analysis when you only need the package tests.

Write files with your editor tool rather than shell heredocs; multi-line
shell quoting is fragile, and an unguarded `cat > file` waits on stdin forever.

## Definition of done

A task is finished only when all of the following hold. Do not report a task
as done otherwise; report what failed instead.

1. `julia --project=test --startup-file=no -m Runic --inplace src test` was run
   after the last edit, and `... -m Runic --check --diff src test` then exits 0.
2. `julia --project=. --startup-file=no -e 'using Pkg; Pkg.test()'` passes.
3. Every new feature or bug fix has a test that fails without the change,
   including bugs you found and fixed on the way.
4. Every public function, type, and constant has a docstring with its
   signature, a short description, and a `jldoctest` example. Doctests run in
   the test suite, so the example output must be exact: check the type of what
   is printed (`1//2` and `1` are not `0.5` and `1.0`).
5. `README.md` shows the main usage when the public API changed.
6. The coverage listing above shows no untested lines in the code you added,
   or you explain why a line cannot be exercised.

## Rules

- Never weaken a check to make it pass: do not delete or skip tests, loosen
  tolerances without a justifying comment, or disable Aqua, ExplicitImports,
  JET, Runic, or doctests. Fix the code. If a check reports a genuine false
  positive, say so explicitly and explain why.
- Do not edit `.github/workflows/`, `LICENSE`, or the `version` field of
  `Project.toml` unless the task asks for it.
- Do not commit `Manifest.toml`, coverage files, or editor and agent settings.
  `.gitignore` already excludes them.
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
  `Pkg.resolve()` afterwards. Every dependency, including standard libraries,
  needs a `[compat]` entry (Aqua fails without one).
- Do not run `Pkg.update()`, `Pkg.gc()`, or registry operations.
- Keep changes focused on the task. Mention unrelated problems you notice
  instead of fixing them silently.

## Code conventions

- Formatting is decided by Runic, not by hand. Run it; do not argue with it.
- Imports are explicit: `using Foo: bar, baz` or `import Foo`. Never bare
  `using Foo`. ExplicitImports fails on implicit and stale imports.
- Export the few entry points users call in every session (a main solver or
  type). Mark every other user-facing name with `public name`. Names that are
  neither are internal and may change freely.
- Prefer type-stable code: concrete container element types, no untyped
  globals, no `Any` fields in structs. JET reports inference failures as
  errors.
- Docstrings follow this shape (the example is a doctest and must print
  exactly what the REPL prints; doctests run with `using {{{PKG}}}`, so call
  `public` but unexported names with the `{{{PKG}}}.` prefix):

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
  tolerance. For a discretized method, measure the actual error at the test's
  resolution and set the tolerance from it; do not guess and then loosen. Test
  edge cases and error paths (`@test_throws`).
- Keep `src/{{{PKG}}}.jl` as the module file; move larger features into
  `src/<feature>.jl` and `include` them from the module file.
- State conventions that users must know in the docstring: index bases
  (ground state `n = 0` or `n = 1`), units, and default keyword values.

## Git

- Work on a branch with a short descriptive name such as `add-shooting-solver`
  (no naming convention is enforced). Make small commits with imperative messages
  ("Add finite-difference Hamiltonian", not "Added…").
- Open a pull request only when asked. Its description follows
  `.github/PULL_REQUEST_TEMPLATE.md`: what changed, why, and which commands
  you ran to validate it.
