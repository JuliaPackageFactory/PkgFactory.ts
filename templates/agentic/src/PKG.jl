module {{{PKG}}}

# Public API, accessed as {{{PKG}}}.hello without exporting the name.
public hello

# Placeholder: replace `hello`, its test, and the README Quick Start with the real API.
"""
    hello()

Return a friendly greeting.

# Examples

```jldoctest
julia> {{{PKG}}}.hello()
"Hello, World!"
```
"""
function hello()
    return "Hello, World!"
end

end
