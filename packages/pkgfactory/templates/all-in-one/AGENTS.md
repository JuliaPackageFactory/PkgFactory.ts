# AGENTS.md

Follow https://juliapackagefactory.github.io/julia-package-guidelines/README.md with package_name={{{PKG}}}.jl and owner={{{OWNER}}}.

## Package

The package name is `{{{PKG}}}`. Use Julia 1.12 or later and run commands from
the repository root. The workspace contains the test and docs environments.

## Commands

```sh
julia --startup-file=no --project=. -e 'using Pkg; Pkg.instantiate()'
julia --startup-file=no --project=. -e 'using Pkg; Pkg.test()'
julia --startup-file=no --project=@runic -m Runic --inplace .
```

Keep source changes, regression tests, and public API documentation consistent.
Format the source code with Runic before committing (install it once with
`julia --startup-file=no --project=@runic -e 'using Pkg; Pkg.add("Runic")'`).
Do not commit generated manifests or coverage output.

## Documentation

```sh
julia --startup-file=no --project=docs -e 'using Pkg; Pkg.instantiate()'
julia --startup-file=no --project=docs docs/make.jl
```

The documentation build runs doctests and writes `docs/build/`. `deploydocs`
deploys only in supported CI environments with credentials.
