```@meta
CurrentModule = {{{PKG}}}
```

# [Developer Guide](@id developer-guide)

If you are planning significant changes, open an [issue](https://github.com/{{{OWNER}}}/{{{PKG}}}.jl/issues) first. The [ColPrac](https://github.com/SciML/ColPrac) guidelines are recommended.

This package follows the [Julia Package Development Guidelines](https://juliapackagefactory.github.io/Guidelines/JuliaPackages?repo={{{OWNER}}}/{{{PKG}}}.jl) of JuliaPackageFactory, rendered for this repository. They cover the one-time setup, the development cycle (Revise, Runic, tests, and documentation), and releases. The Markdown source is at <https://juliapackagefactory.github.io/Guidelines/JuliaPackages.md>.

## Maintainer Notes

The documentation build generates the BibTeX citation shown in the docs from `CITATION.cff` (see `docs/citation.jl`).
Check each author's `family-names` and `given-names` in [CITATION.cff](https://github.com/{{{OWNER}}}/{{{PKG}}}.jl/blob/main/CITATION.cff) before release. Add `orcid`
and DOI `identifiers` only when the corresponding identifiers are available.
