# Technology Stack

**Analysis Date:** 2026-06-09

## Languages

**Primary:**
- TypeScript — agent skill definition and type declarations (`tsconfig.json`, `skills/list-curator-agent/SKILL.md`)
- JavaScript (ESM) — CI gate tooling (`extension-kind-gate.mjs`)

**Secondary:**
- JSON — agent flow specification and OpenAPI-style spec (`cinatra/oas.json`)

## Runtime

**Environment:**
- Node.js — required for `extension-kind-gate.mjs` (uses `node:fs`, `node:path` builtins; no third-party deps)

**Package Manager:**
- npm — `.npmrc` present (existence only; contents not read)
- Lockfile: not detected (no `package-lock.json` found in root)

## Frameworks

**Core:**
- Cinatra Agent Framework (`agentspec_version: 26.1.0`) — declarative Flow-type agent runtime; defined in `cinatra/oas.json`
- No traditional application framework (Express, Fastify, etc.) — this is a no-src agent-spec repo

**Testing:**
- Not detected — no `jest.config.*`, `vitest.config.*`, or test files found

**Build/Dev:**
- TypeScript compiler (`tsc`) — configured via `tsconfig.json`; `outDir: dist`, `rootDir: src`
- No bundler detected (no webpack, esbuild, vite config)

## Key Dependencies

**Critical:**
- `@cinatra-ai/list-curator-agent` (self, `package.json` `name`) `v0.1.0` — the published package identity
- Cinatra LLM Bridge (`{{CINATRA_BASE_URL}}/api/llm-bridge`) — all LLM execution routes through this internal endpoint declared in `cinatra/oas.json` (`curate` ApiNode)
- OpenAI — preferred LLM provider; model `gpt-5.5` declared in `cinatra/oas.json` `metadata.cinatra.llm`

**Infrastructure:**
- `cinatra/oas.json` (`package.json` `cinatra.dependencies: []`) — no declared Cinatra package dependencies; child agents are resolved at runtime via `agent_list` MCP primitive

## Configuration

**Environment:**
- `CINATRA_BASE_URL` — template variable used in `cinatra/oas.json` to resolve the LLM bridge endpoint (`{{CINATRA_BASE_URL}}/api/llm-bridge`)
- `.npmrc` present — likely configures the `@cinatra-ai` private registry (contents not read)

**Build:**
- `tsconfig.json` — standalone strict TypeScript config; ES2023 target, ESNext modules, `bundler` module resolution, `isolatedModules: true`, `verbatimModuleSyntax: true`; includes `src/**/*.ts` and `src/**/*.tsx` (no `src/` directory exists yet — spec-only repo)

## Platform Requirements

**Development:**
- Node.js (version not pinned — no `.nvmrc` or `.node-version`)
- Access to `@cinatra-ai` private npm registry (configured via `.npmrc`)

**Production:**
- Cinatra platform runtime — agent is executed as a hosted Flow via `cinatra/oas.json`; no self-hosted server required
- Cinatra LLM Bridge must be reachable at `CINATRA_BASE_URL`

---

*Stack analysis: 2026-06-09*
