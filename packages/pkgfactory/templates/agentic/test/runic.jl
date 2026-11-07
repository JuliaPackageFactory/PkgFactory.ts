using Runic
using Test

# Fail the test suite when Julia sources are not formatted with Runic.
# Fix with:  julia --project=test --startup-file=no -m Runic --inplace src test
@testset "Runic.jl" begin
    root = normpath(joinpath(@__DIR__, ".."))
    options = Sys.which("git") === nothing ? ["--check"] : ["--check", "--diff"]
    @test Runic.main([options..., joinpath(root, "src"), joinpath(root, "test")]) == 0
end
