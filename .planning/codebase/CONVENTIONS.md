# Coding Conventions

**Analysis Date:** 2026-06-09

## Overview

This is a content-only Cinatra agent extension repo. The primary artifact is
`skills/list-curator-agent/SKILL.md` (the LLM system prompt) and
`cinatra/oas.json` (the agent contract). The only executable TypeScript/JS file
is `extension-kind-gate.mjs` — a self-contained CI gate script with no
`@cinatra-ai/*` dependencies.

## Naming Patterns

**Files:**
- Config/manifest: lowercase with dots — `package.json`, `tsconfig.json`
- Gate script: kebab-case with `.mjs` extension — `extension-kind-gate.mjs`
- Agent contract: lowercase — `cinatra/oas.json`
- Skill prompt: `SKILL.md` (uppercase, in `skills/<agent-name>/`)

**Functions (in `extension-kind-gate.mjs`):**
- camelCase for all exported and internal functions — `parseArgs`, `validateAgent`,
  `validateWorkflow`, `validateBpmnSanity`, `findWorkflowSidecars`, `runGate`
- camelCase for local helpers — `wordBoundary`, `walkLlmStrings`, `scanOasString`

**Variables:**
- camelCase — `packageRoot`, `oasPath`, `bpmnPrefixes`, `openTags`
- Constants: camelCase for sets/maps (`LLM_VISIBLE_FIELDS`, `BANNED_PRIMITIVES`)
  use UPPER_SNAKE_CASE for frozen module-level arrays/sets of config values

**Types:**
- String literals for discriminated unions — `"agent" | "workflow"` (from `pkg.cinatra.kind`)
- No TypeScript types in the gate script (it is `.mjs`, plain JavaScript)

## Code Style

**Formatting:**
- No Prettier or ESLint config detected in this repo
- `tsconfig.json` targets ES2023, ESNext modules, strict mode (`"strict": true`),
  but `"noImplicitAny": false` relaxes implicit-any enforcement
- Gate script uses 2-space indentation consistently

**Linting:**
- No `.eslintrc*` or `eslint.config.*` detected
- No `biome.json` detected
- CI runs `node extension-kind-gate.mjs` as the sole static analysis step

## Import Organization

**In `extension-kind-gate.mjs`:**
- All imports are Node built-ins only — `node:fs`, `node:path`
- No third-party or `@cinatra-ai/*` imports (intentional: CI runs unauthenticated)
- Imports grouped together at top, no blank-line separation between them

**Path Aliases:**
- None — the gate has no module resolver; `tsconfig.json` paths are for a `src/`
  directory that does not exist in this repo

## Error Handling

**Patterns:**
- Gate functions return `string[]` errors (pure, no throws on validation failures)
- Try/catch around filesystem reads; errors are caught and pushed to the errors array
  as human-readable strings — `err instanceof Error ? err.message : String(err)`
- Fatal/unexpected errors in `main()` are caught with a top-level try/catch that
  logs and calls `process.exit(1)`
- No unhandled promise rejections (script is fully synchronous)

**LLM system-prompt error conventions (in `SKILL.md`):**
- Error envelopes always return a JSON object with the shape:
  `{ listId, memberCount, accountsCreated, contactsCreated, failures, summary }`
- `listId: ""` signals an early-exit / failure envelope
- `failures` is `Array<{rowIndex?, stage, error, accountId?, contactId?}>`
- Row-level failures are best-effort: append to `failures[]` and CONTINUE
- Abort conditions are explicit and enumerated (5 named abort cases)

## Logging

**Framework:** `console.log` / `console.error` (Node built-ins only)

**Patterns:**
- Success: `console.log("✓ extension-kind-gate: ...")` to stdout, exit 0
- Failure: `console.error("✗ extension-kind-gate: N violations:")` + per-violation
  bullet `• <message>` to stderr, exit 1
- No structured/JSON logging in this repo

## Comments

**When to Comment:**
- Module-level block comments explain the WHY and scope of the gate script
  (who uses it, what it validates, what it intentionally does NOT validate)
- Section-divider comments (`// ---`) separate logical sections in `extension-kind-gate.mjs`
- Inline comments explain non-obvious decisions (e.g., why `npx` over `pnpm dlx`)

**JSDoc/TSDoc:**
- JSDoc block comments on exported functions — `/** ... */` style
- Concise: one sentence purpose + key caveats ("Pure: returns string[] errors")
- No `@param`/`@returns` tags used

## Module Design

**Exports:**
- Named exports only in `extension-kind-gate.mjs` — `parseArgs`, `validateAgent`,
  `validateWorkflowPackageShape`, `validateBpmnSanity`, `findWorkflowSidecars`,
  `validateWorkflow`, `runGate`
- `main()` is NOT exported; it is invoked only when the file is run directly
  (guarded by `invokedDirectly` check using `import.meta.url`)

**Barrel Files:** Not applicable — single-file script

## SKILL.md Authoring Conventions

**Structure:**
- YAML front matter with `name` and `description` fields
- H1 heading matching agent name
- Sections: Inputs, Tool discipline, Step-by-step recipe, HITL gate payload shapes,
  Polling protocol, Best-effort row-processing semantic, memberRef construction,
  Return shape, Defensive caps, Current scope notes

**Tone:**
- Imperative and precise — "SKIP this step", "CONTINUE", "RETURN EXACTLY"
- Keywords like REQUIRED, SKIP, CONTINUE, ABORT in uppercase for LLM salience
- JSON code blocks for all payload/return shapes
- Tables for enumerating alternatives (e.g. `memberRef construction` table)

---

*Convention analysis: 2026-06-09*
