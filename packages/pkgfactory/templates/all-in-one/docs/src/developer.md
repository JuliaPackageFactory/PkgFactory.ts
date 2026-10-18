```@meta
CurrentModule = {{{PKG}}}
```

# [Developer Guide](@id developer-guide)

If you are planning significant changes, open an [issue](https://github.com/{{{OWNER}}}/{{{PKG}}}.jl/issues) first. The [ColPrac](https://github.com/SciML/ColPrac) guidelines are recommended.

This package follows the central [JuliaPackageFactory Developer Guide](https://juliapackagefactory.github.io/DevGuide/?package_name={{{PKG}}}.jl&owner={{{OWNER}}}), rendered with this package's name and owner filled in. It covers the one-time local setup, the daily development flow (Revise, Runic, tests, and documentation), and versioning and registration for maintainers. The Markdown source of the guide is available at <https://juliapackagefactory.github.io/DevGuide/README.md>.

## Maintainer Notes

The documentation build generates the BibTeX citation shown in the docs from `CITATION.cff` (see `docs/citation.jl`).
Check each author's `family-names` and `given-names` in [CITATION.cff](https://github.com/{{{OWNER}}}/{{{PKG}}}.jl/blob/main/CITATION.cff) before release. Add `orcid`
and DOI `identifiers` only when the corresponding identifiers are available.
