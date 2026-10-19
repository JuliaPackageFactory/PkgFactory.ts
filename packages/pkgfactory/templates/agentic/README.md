# {{{PKG}}}.jl

[![Julia 1.12+](https://badgen.net/static/Julia/1.12%2B/007ec6?icon=https%3A%2F%2Fraw.githubusercontent.com%2FJuliaLang%2Fjulia-logo-graphics%2Fmaster%2Fimages%2Fjulia-dots.svg)](https://julialang.org/downloads/)
[![Citation](https://img.shields.io/badge/citation-CFF-7A8288)](CITATION.cff)
[![license](https://img.shields.io/github/license/{{{OWNER}}}/{{{PKG}}}.jl?label=license)](LICENSE)
[![code style: runic](https://img.shields.io/badge/code_style-%E1%9A%B1%E1%9A%A2%E1%9A%BE%E1%9B%81%E1%9A%B2-black)](https://github.com/fredrikekre/Runic.jl)
[![CI](https://github.com/{{{OWNER}}}/{{{PKG}}}.jl/actions/workflows/CI.yml/badge.svg?branch=main)](https://github.com/{{{OWNER}}}/{{{PKG}}}.jl/actions/workflows/CI.yml?query=branch%3Amain)

{{{DESCR}}}

## Quick Start

Requires [Julia](https://julialang.org/install/) 1.12 or later. Paste the following into the Julia REPL or a notebook cell:

```julia
import Pkg; Pkg.add(url="https://github.com/{{{OWNER}}}/{{{PKG}}}.jl.git")
import {{{PKG}}}; {{{PKG}}}.hello()  # returns "Hello, World!"
```

## Development

This package is set up for development with AI coding agents (Claude Code, Codex, Cursor, Copilot, and others).
[AGENTS.md](AGENTS.md) holds the instructions that agents and contributors follow: the commands to run, the
conventions to keep, and the checks that must pass before a change is finished.

Clone the repository, move into its directory, and run the test suite with:

```shell
git clone https://github.com/{{{OWNER}}}/{{{REPO}}}.git
cd {{{PKG}}}.jl
julia --project=. --startup-file=no -e "using Pkg; Pkg.test()"
```

The test suite also runs doctests, [Aqua](https://github.com/JuliaTesting/Aqua.jl), [ExplicitImports](https://github.com/JuliaTesting/ExplicitImports.jl),
[JET](https://github.com/aviatesk/JET.jl), and a [Runic](https://github.com/fredrikekre/Runic.jl) formatting check.
Format the code with:

```shell
julia --project=test --startup-file=no -m Runic --inplace src test
```

## Citation

If you use this package in your work, please cite it. [CITATION.cff](CITATION.cff) holds the metadata;
GitHub's "Cite this repository" button on the repository page renders it as APA or BibTeX.

## Acknowledgments

This package is built on an initial project template generated using [Julia Package Factory](https://github.com/JuliaPackageFactory).
