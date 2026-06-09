# Testing Patterns

**Analysis Date:** 2026-06-09

## Overview

This is a content-only Cinatra agent extension repo with no test framework
configured and no test files present. The sole executable file,
`extension-kind-gate.mjs`, ships exported functions that are designed to be
testable (pure functions returning `string[]`) but no test suite exists in
this repo.

The CI pipeline at `.github/workflows/ci.yml` reflects this:
- For source-mirror repos (those with `@cinatra-ai/*` optional peers — which
  this repo is), `pnpm test --if-present` is explicitly skipped. The cinatra
  monorepo owns running tests for these extensions.
- For standalone repos with no first-party peers, CI runs
  `corepack pnpm test --if-present`, which is a no-op if no `test` script exists.

## Test Framework

**Runner:** Not configured

**Assertion Library:** Not detected

**Config:** No `jest.config.*`, `vitest.config.*`, or `mocha` config found

**Run Commands:**
```bash
# No test script in package.json — no test command available in this repo
# The monorepo runs tests for this extension via its own test infrastructure
```

## Test File Organization

**Location:** No test files present

**Naming:** Not applicable

**Structure:** Not applicable

## CI Validation (Substitutes for Tests)

The repo's quality gate is `extension-kind-gate.mjs`, run in CI by:

```yaml
# .github/workflows/ci.yml — kind-gates job
- name: Agent OAS validation gate
  run: node extension-kind-gate.mjs --package-root .
```

This gate:
- Parses `cinatra/oas.json` and walks all LLM-visible string fields (`system`,
  `user`, `description`)
- Rejects use of banned/retired CRM primitives (`lists_*`, `accounts_*`,
  `contacts_*`) and legacy entity typeHints (`@cinatra-ai/entity-accounts:account`,
  `@cinatra-ai/entity-contacts:contact`)
- Exit 0 = clean, Exit 1 = violations

Additionally the `build` job validates:
- `package.json` dependency shape: no first-party `@cinatra-ai/*` in
  `dependencies`/`devDependencies`/`optionalDependencies`
- TypeScript typecheck (skipped for this source-mirror repo)
- `npm pack --dry-run` for publish-payload shape

## Testable Surface in `extension-kind-gate.mjs`

All exported functions are pure (no side effects, `string[]` return type) and
designed for unit testing:

| Function | What it validates |
|---|---|
| `parseArgs(argv)` | CLI argument parsing |
| `validateAgent(packageRoot)` | OAS banned-primitive scan |
| `validateWorkflowPackageShape(pkg)` | `package.json` shape for workflow kind |
| `validateBpmnSanity(xml)` | BPMN XML well-formedness + namespace check |
| `findWorkflowSidecars(packageRoot)` | Locates `cinatra/workflow.bpmn` files |
| `validateWorkflow(packageRoot)` | Full workflow extension validation |
| `runGate(packageRoot)` | Top-level dispatch by `cinatra.kind` |

These functions could be tested with any Node-compatible test runner (Vitest,
Jest, Node's built-in `node:test`) without additional setup. The monorepo is
assumed to provide this coverage.

## Mocking

Not applicable — no test suite present.

## Fixtures and Factories

Not applicable — no test suite present.

## Coverage

**Requirements:** None enforced in this repo

**Tooling:** Not configured

## Test Types

**Unit Tests:** Not present (functions in `extension-kind-gate.mjs` are structured for unit testing but untested in this repo)

**Integration Tests:** Not present

**E2E Tests:** Not applicable

## Adding Tests (Guidance for Future Work)

If tests are added to this repo, the recommended approach given the existing structure:

1. Use Vitest or Node's built-in `node:test` (zero additional deps, matches ESM module format)
2. Import named exports directly from `extension-kind-gate.mjs`
3. Test `validateBpmnSanity` with inline XML strings (pure string→string[] function)
4. Test `validateAgent` with a temp dir fixture containing a `cinatra/oas.json`
5. Add a `"test": "vitest run"` or `"test": "node --test"` script to `package.json`
6. CI will automatically pick it up via `corepack pnpm test --if-present`

---

*Testing analysis: 2026-06-09*
