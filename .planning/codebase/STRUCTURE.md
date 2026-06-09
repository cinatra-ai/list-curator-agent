# Codebase Structure

**Analysis Date:** 2026-06-09

## Directory Layout

```
list-curator-agent/
├── cinatra/
│   └── oas.json              # Cinatra Flow manifest (agentspec 26.1.0): nodes, edges, I/O, HITL screen names, preferred LLM
├── skills/
│   └── list-curator-agent/
│       └── SKILL.md          # Full orchestrator prompt: 7-step recipe, tool discipline, HITL gate shapes, error envelopes
├── .github/
│   └── workflows/
│       ├── ci.yml            # CI: classify repo, kind-gate, pack dry-run
│       └── release.yml       # Release pipeline
├── extension-kind-gate.mjs   # Zero-dependency Node.js CI gate: OAS banned-primitive scan + workflow BPMN sanity
├── package.json              # npm package manifest: @cinatra-ai/list-curator-agent v0.1.0, cinatra.kind: "agent"
├── tsconfig.json             # TypeScript config (no TS sources currently tracked — content-only extension)
├── .npmrc                    # npm registry config (existence noted; contents not read)
├── LICENSE                   # Apache-2.0
└── README.md                 # Project readme
```

## Directory Purposes

**`cinatra/`:**
- Purpose: Cinatra platform artifacts consumed by the marketplace and runtime
- Contains: `oas.json` — the machine-readable Flow graph (StartNode, ApiNode, EndNode, data-flow edges, I/O schemas, HITL screen registrations)
- Key files: `cinatra/oas.json`

**`skills/list-curator-agent/`:**
- Purpose: Agent skill content auto-discovered by the Cinatra LLM bridge via `agent_id: "list-curator-agent"`
- Contains: `SKILL.md` — the complete step-by-step orchestrator prompt injected as system context at runtime
- Key files: `skills/list-curator-agent/SKILL.md`

**`.github/workflows/`:**
- Purpose: GitHub Actions CI/CD pipelines
- Contains: `ci.yml` (build + kind-gates), `release.yml` (publish)
- Key files: `.github/workflows/ci.yml`, `.github/workflows/release.yml`

## Key File Locations

**Entry Point (runtime):**
- `cinatra/oas.json`: Flow definition; `start_node` references the StartNode; `$referenced_components.curate` is the ApiNode that calls `/api/llm-bridge`

**Orchestrator Logic:**
- `skills/list-curator-agent/SKILL.md`: All behavioral logic — steps, constraints, tool allowlist, HITL gate payloads, polling cadence, return schema

**CI Validation:**
- `extension-kind-gate.mjs`: Self-contained gate run as `node extension-kind-gate.mjs --package-root .`; exports `validateAgent()`, `validateWorkflow()`, `runGate()` (also importable for testing)

**Package Identity:**
- `package.json`: Declares `name: "@cinatra-ai/list-curator-agent"`, `version: "0.1.0"`, `cinatra.kind: "agent"`, `cinatra.apiVersion: "cinatra.ai/v1"`, `cinatra.dependencies: []`

**TypeScript Config:**
- `tsconfig.json`: Present for tooling compatibility; no `.ts` sources are tracked (this is a content-only extension — SKILL.md + OAS JSON)

## Naming Conventions

**Files:**
- Cinatra platform artifacts: placed under `cinatra/` with fixed names (`oas.json` for agents, `workflow.bpmn` for workflows)
- Skill prompt: `SKILL.md` (uppercase) under `skills/<agent-slug>/`
- Gate script: `extension-kind-gate.mjs` (kebab-case, `.mjs` ES module)
- CI workflows: kebab-case `.yml` under `.github/workflows/`

**Directories:**
- Skill directory name matches agent slug: `skills/list-curator-agent/` matches package name `@cinatra-ai/list-curator-agent`
- No `src/` directory — this is a prompt-only, content-only agent extension with no application source code

**Package naming:**
- Agent packages follow pattern `@<scope>/<slug>-agent` (e.g. `@cinatra-ai/list-curator-agent`)
- Workflow packages follow pattern `@<scope>/<slug>-workflow` (enforced by `extension-kind-gate.mjs` regex)

## Where to Add New Code

**New orchestrator behavior (steps, rules, constraints):**
- Edit: `skills/list-curator-agent/SKILL.md`
- This is the only file the LLM reads at runtime; all behavioral changes go here

**New Flow inputs or outputs:**
- Edit: `cinatra/oas.json` — add to both the top-level `inputs`/`outputs` arrays AND the corresponding StartNode/ApiNode/EndNode `$referenced_components` sections, plus any `data_flow_connections` edges needed

**New HITL gate screen:**
- Register name in `cinatra/oas.json` under `metadata.cinatra.hitlScreens`
- Document the INTERRUPT payload shape in `skills/list-curator-agent/SKILL.md`

**New CI validation rule:**
- Add banned token/pattern to `BANNED_PRIMITIVES`, `BANNED_TYPEHINTS`, or a new pattern in `extension-kind-gate.mjs`

**New child agent dependency:**
- No `package.json` dependency entry needed (child agents are resolved at runtime via `agent_list` MCP call)
- Document the child in SKILL.md under the relevant step

## Special Directories

**`cinatra/`:**
- Purpose: Cinatra platform sidecar artifacts
- Generated: No (hand-authored / tooling-generated from monorepo extraction)
- Committed: Yes

**`skills/`:**
- Purpose: Skill prompt content for LLM bridge auto-discovery
- Generated: No
- Committed: Yes

**`.planning/`:**
- Purpose: GSD planning and codebase analysis documents
- Generated: Yes (by GSD tooling)
- Committed: Up to team convention

---

*Structure analysis: 2026-06-09*
