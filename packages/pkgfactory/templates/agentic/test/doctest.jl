using {{{PKG}}}
using Documenter: Documenter, DocMeta, makedocs
using Test

# Run the examples in docstrings (```jldoctest blocks) and compare their output.
# This is Documenter.doctest({{{PKG}}}; manual = false) without the edit-link lookup,
# which needs network access to the Git remote and only warns otherwise.
@testset "Doctests" begin
    DocMeta.setdocmeta!({{{PKG}}}, :DocTestSetup, :(using {{{PKG}}}); recursive = true)
    root = mktempdir()
    mkdir(joinpath(root, "src"))
    makedocs(;
        root, sitename = "", doctest = :only, modules = [{{{PKG}}}], remotes = nothing,
        format = Documenter.HTML(edit_link = nothing)
    )
    @test true
end
