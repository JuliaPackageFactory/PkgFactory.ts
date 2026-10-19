# {{{PKG}}}.jl

[![Julia 1.12+](https://badgen.net/static/Julia/1.12%2B/007ec6?icon=https%3A%2F%2Fraw.githubusercontent.com%2FJuliaLang%2Fjulia-logo-graphics%2Fmaster%2Fimages%2Fjulia-dots.svg)](https://julialang.org/downloads/)
[![Citation](https://img.shields.io/badge/citation-CFF-7A8288)](CITATION.cff)
[![license](https://img.shields.io/github/license/{{{OWNER}}}/{{{PKG}}}.jl?label=license)](LICENSE)
[![code style: runic](https://img.shields.io/badge/code_style-%E1%9A%B1%E1%9A%A2%E1%9A%BE%E1%9B%81%E1%9A%B2-black)](https://github.com/fredrikekre/Runic.jl)
[![contributer's guide: ColPrac](https://img.shields.io/badge/contributer%27s%20guide-ColPrac-blueviolet)](https://github.com/SciML/ColPrac)
[![CI](https://github.com/{{{OWNER}}}/{{{PKG}}}.jl/actions/workflows/CI.yml/badge.svg?branch=main)](https://github.com/{{{OWNER}}}/{{{PKG}}}.jl/actions/workflows/CI.yml?query=branch%3Amain)
[![Aqua](https://img.shields.io/github/actions/workflow/status/{{{OWNER}}}/{{{PKG}}}.jl/Aqua.yml?branch=main&event=push&label=Aqua&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA3OS4zNzUgNTguNjc0Ij48ZyBzdHJva2U9IiNmNWY1ZjUiIHN0cm9rZS13aWR0aD0iNC44ODciPjxjaXJjbGUgZmlsbD0iIzM4OTgyNiIgY3g9IjM5LjY4OCIgY3k9IjIzLjk5MiIgcj0iMjEuNTQ5Ii8%2BPGNpcmNsZSBmaWxsPSIjY2IzYzMzIiBjeD0iMTcuNDQzIiBjeT0iNDEuMjMxIiByPSIxNSIvPjxjaXJjbGUgZmlsbD0iIzk1NThiMiIgY3g9IjYxLjkzMiIgY3k9IjQxLjIzMSIgcj0iMTUiLz48L2c%2BPC9zdmc%2B)](https://github.com/{{{OWNER}}}/{{{PKG}}}.jl/actions/workflows/Aqua.yml?query=branch%3Amain)
[![JET](https://img.shields.io/github/actions/workflow/status/{{{OWNER}}}/{{{PKG}}}.jl/JET.yml?branch=main&event=push&label=%F0%9F%9B%A9%EF%B8%8F%20JET)](https://github.com/{{{OWNER}}}/{{{PKG}}}.jl/actions/workflows/JET.yml?query=branch%3Amain)

{{{DESCR}}}

## Quick Start

Requires [Julia](https://julialang.org/install/) 1.12 or later. Paste the following into the Julia REPL or a notebook cell:

```julia
import Pkg; Pkg.add(url="https://github.com/{{{OWNER}}}/{{{PKG}}}.jl.git")
import {{{PKG}}}; {{{PKG}}}.hello()  # returns "Hello, World!"
```

## Development

Development, by AI coding agents and by people, follows [AGENTS.md](AGENTS.md): the commands to run,
the conventions to keep, and the checks that must pass before a change is finished. See
[CONTRIBUTING.md](CONTRIBUTING.md) for how issues and pull requests are handled.

## Releasing

This package follows [Semantic Versioning](https://semver.org/). To release a version:

1. Set the same version in [Project.toml](Project.toml) (`version`) and [CITATION.cff](CITATION.cff)
   (`version`, and `date-released` to the release date).
2. Register the version with [Registrator](https://github.com/JuliaRegistries/Registrator.jl#via-the-github-app)
   by commenting `@JuliaRegistrator register` on the release commit.
3. After the registration is merged, [TagBot](https://github.com/JuliaRegistries/TagBot) creates the tag
   and the GitHub release automatically.

## Citation

If you use this package in your work, please cite it. [CITATION.cff](CITATION.cff) holds the metadata;
GitHub's "Cite this repository" button on the repository page renders it as APA or BibTeX.

## Acknowledgments

This package is built on an initial project template generated using [Julia Package Factory](https://github.com/JuliaPackageFactory).
