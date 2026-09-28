PkgFactory for TypeScript is derived from the JuliaPackageFactory/PkgFactory.jl
templates and Web UI at commit 7c7d4afeaa3b4b708726af4795c13c192fc3c948 (MIT).
Copyright (c) 2025-2026 Shuhei Ohno and contributors.

The 58 reference template sources are preserved under packages/pkgfactory/templates.
The Web stylesheet and SVG logo are retained from apps/web/public; the Web
workflow is adapted for authorization-code PKCE, preview, and saved-plan resume.
Rendering intentionally escapes Julia strings and is not a byte-compatible legacy API.
OAuth integration uses @cloudflare/workers-oauth-provider (MIT).
MCP uses the official @modelcontextprotocol/sdk (MIT).
