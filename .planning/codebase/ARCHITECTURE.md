<!-- refreshed: 2026-06-09 -->
# Architecture

**Analysis Date:** 2026-06-09

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        Cinatra Runtime / LLM Bridge                  │
│              POST /api/llm-bridge  (ApiNode: "curate")               │
└─────────────────────────────┬───────────────────────────────────────┘
                               │  SKILL.md prompt injected by bridge
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   List Curator Orchestrator (LLM)                    │
│   Step 1: Parse intent, validate targetMemberType, propose schema    │
│   Step 2: HITL Gate 1 — scrape-schema-review INTERRUPT               │
│   Step 3: agent_run(@cinatra-ai/web-scrape-agent)                    │
│   Step 4: agent_run(@cinatra-ai/company-discovery-agent) × N rows    │
│   Step 5: agent_run(@cinatra-ai/contact-discovery-agent) × N accts   │
│   Step 6: Build memberRefs + HITL Gate 2 — final-list-review         │
│   Step 7: crm_list_create + crm_list_member_add × M members          │
└────┬──────────────┬──────────────────┬────────────────────┬─────────┘
     │              │                  │                    │
     ▼              ▼                  ▼                    ▼
web-scrape-   company-discovery-  contact-discovery-  CRM facade
  agent           agent               agent           (crm_* MCP)
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Flow manifest (OAS) | Declares the cinatra Flow graph: StartNode → ApiNode → EndNode, I/O schemas, HITL screen names, preferred LLM | `cinatra/oas.json` |
| Orchestrator prompt (SKILL.md) | Complete 7-step recipe the LLM executes; defines tool discipline, HITL gate payloads, polling protocol, error envelopes | `skills/list-curator-agent/SKILL.md` |
| CI kind-gate script | Zero-dependency Node.js gate that validates `cinatra/oas.json` for banned/retired CRM primitives in LLM-visible strings; also supports workflow BPMN sanity checks | `extension-kind-gate.mjs` |
| GitHub CI pipeline | Triggers kind-gate + pack dry-run; classifies repo as source-mirror vs standalone; skips install/typecheck/test for source mirrors | `.github/workflows/ci.yml` |
| Release pipeline | Not inspected — declared in `.github/workflows/release.yml` | `.github/workflows/release.yml` |

## Pattern Overview

**Overall:** LLM-orchestrated multi-agent workflow with human-in-the-loop (HITL) gates.

**Key Characteristics:**
- The orchestrator is a *prompt-only agent* — no application code runs at runtime. The LLM interprets SKILL.md and drives the flow.
- The Cinatra platform bridges inputs from `cinatra/oas.json` into the LLM call at `/api/llm-bridge`. The bridge auto-discovers `SKILL.md` via `agent_id: "list-curator-agent"`.
- Two mandatory HITL INTERRUPT pauses (`scrape-schema-review`, `final-list-review`) gate destructive actions (scraping, CRM writes).
- Child agents (`web-scrape-agent`, `company-discovery-agent`, `contact-discovery-agent`) are dispatched via `agent_run` MCP primitive and polled via `agent_run_get` — the orchestrator never calls them directly.
- All CRM writes happen only after Gate 2 operator approval via `crm_list_create` + `crm_list_member_add`.

## Layers

**Flow Declaration Layer:**
- Purpose: Machine-readable graph describing nodes, data flow edges, I/O schemas, and HITL screen registrations
- Location: `cinatra/oas.json`
- Contains: StartNode, ApiNode (`curate`), EndNode definitions; `agentspec_version: 26.1.0`
- Depends on: Cinatra platform runtime
- Used by: Cinatra marketplace; runtime flow executor

**Orchestration Prompt Layer:**
- Purpose: The executable specification the LLM follows step-by-step
- Location: `skills/list-curator-agent/SKILL.md`
- Contains: 7 steps, tool discipline rules, HITL gate payload shapes, polling protocol, best-effort failure semantics, return shape
- Depends on: LLM model (`openai/gpt-5.5` preferred), Cinatra self-MCP tool injection
- Used by: LLM bridge — injected as system context on every run

**CI Validation Layer:**
- Purpose: Pre-publish sanity gate that validates the agent OAS for banned retired CRM primitives
- Location: `extension-kind-gate.mjs`
- Contains: `validateAgent()`, `walkLlmStrings()`, `scanOasString()`, banned primitive list, BPMN workflow gate (for peer kinds)
- Depends on: Node.js builtins only (zero external deps)
- Used by: `.github/workflows/ci.yml` (Agent OAS validation gate step)

## Data Flow

### Primary Request Path (happy path)

1. Operator submits `{ intent, seedUrls?, targetMemberType?, listName? }` — StartNode (`cinatra/oas.json` lines 265-317)
2. Cinatra runtime routes to ApiNode `curate` → POST `/api/llm-bridge` with system + user prompts interpolated from inputs (`cinatra/oas.json` lines 318-407)
3. LLM reads SKILL.md, validates `targetMemberType`, derives `seedUrls`/`listName` if empty, proposes scrape schema (SKILL.md Step 1)
4. LLM emits INTERRUPT `x-renderer: "@cinatra-ai/list-curator-agent:scrape-schema-review"` — Gate 1 pauses the run (SKILL.md Step 2)
5. Operator approves/edits `{ instructions, outputSchema, seedUrls }` → run resumes
6. LLM calls `agent_list` then `agent_run(@cinatra-ai/web-scrape-agent)`, polls `agent_run_get` every 5s up to 60 cycles (SKILL.md Step 3)
7. For each scraped row, LLM dispatches `agent_run(@cinatra-ai/company-discovery-agent)`, collects `accountIds` (SKILL.md Step 4)
8. For each `accountId` (when `targetMemberType === "contact"`), LLM dispatches `agent_run(@cinatra-ai/contact-discovery-agent)`, collects `contactIds` (SKILL.md Step 5)
9. LLM builds `memberRefs`, emits INTERRUPT `x-renderer: "@cinatra-ai/list-curator-agent:final-list-review"` — Gate 2 pauses (SKILL.md Step 6)
10. Operator approves → LLM calls `crm_list_create({ slug, name, objectType })`, then loops `crm_list_member_add` for each `memberRef` (SKILL.md Step 7)
11. LLM returns `{ listId, memberCount, accountsCreated, contactsCreated, failures, summary }` → EndNode (`cinatra/oas.json` lines 408-449)

### Error / Early-Exit Paths

1. `targetMemberType === "mixed"` → immediate error envelope from Step 1, no child calls
2. Gate 1 rejected → error envelope `{ failures: [{stage:"gate-1", error:"rejected"}] }`
3. Scrape returns 0 items → error envelope, no further steps
4. Gate 2 rejected → error envelope `{ failures: [{stage:"gate-2", error:"rejected"}] }`
5. `memberCount === 0` after Steps 4-5 → error envelope, no CRM writes
6. `crm_list_create` throws → error envelope; members are NOT added

**State Management:**
- All mutable state (`failures[]`, `accountIds[]`, `contactIdsByAccount{}`, counters) is held in the LLM's in-context working memory for the duration of a single run. No external state store.

## Key Abstractions

**HITL Gate (INTERRUPT):**
- Purpose: Pause the run and surface a structured payload to the operator UI for review/edit/approve
- Two gates: `scrape-schema-review` (Gate 1) and `final-list-review` (Gate 2)
- Registered in `cinatra/oas.json` under `metadata.cinatra.hitlScreens`
- Protocol defined in SKILL.md "HITL gate payload shapes" section

**Best-effort Row Processing:**
- Purpose: Tolerate individual row failures (Steps 4-5) without aborting the entire run
- Failures captured in `failures[]` with `{ rowIndex, stage, error }`; run continues
- Hard-abort conditions enumerated in SKILL.md "Best-effort row-processing semantic" section

**Child Agent Dispatch via agent_run:**
- Purpose: Delegate scraping, account discovery, and contact discovery to specialized sub-agents
- Pattern: `agent_list(packageName)` → `agent_run(templateId, inputParams)` → poll `agent_run_get(runId)` until terminal
- Polling: 5s cadence, 60-cycle max (5-minute cap) per child

**CRM Facade (crm_* primitives):**
- Purpose: All CRM writes go through `crm_list_create` / `crm_list_member_add` — legacy `lists_*`, `accounts_*`, `contacts_*`, `objects_*` primitives are banned
- Enforcement: CI gate (`extension-kind-gate.mjs`) scans `cinatra/oas.json` LLM-visible fields for banned tokens

## Entry Points

**Cinatra Platform (runtime):**
- Location: `cinatra/oas.json` → `start_node.$component_ref: "start"`
- Triggers: Operator or caller submits inputs; platform instantiates the Flow
- Responsibilities: Validate inputs, pass to ApiNode `curate`, return EndNode outputs

**CI Gate (development):**
- Location: `extension-kind-gate.mjs` (main function)
- Triggers: `node extension-kind-gate.mjs --package-root .` in `.github/workflows/ci.yml`
- Responsibilities: Parse `cinatra/oas.json`, walk LLM-visible strings, fail on banned primitives

## Architectural Constraints

- **LLM execution model:** Single LLM call per run orchestrated by Cinatra's `/api/llm-bridge`. The LLM is the sole executor of Steps 1-7; no server-side application code runs the steps.
- **Global state:** None — no module-level singletons. All run state lives in LLM context.
- **Circular imports:** Not applicable (no application source files).
- **Mixed member type:** `"mixed"` is explicitly unsupported; CRM lists (Twenty Views) are per-object-type. Rejected at Step 1.
- **Non-atomic list creation:** `crm_list_create` + N × `crm_list_member_add` are separate calls. Partial-member failures are surfaced in `failures[]`; the list persists with whatever members succeeded.
- **No child HITL auto-resume:** If a child agent enters `pending_approval` for >30s (6 poll cycles), it is surfaced as a failure and processing continues to the next row.

## Anti-Patterns

### Calling legacy CRM primitives

**What happens:** Using `lists_create`, `accounts_list`, `contacts_get`, `objects_list`, or entity typeHints like `@cinatra-ai/entity-accounts:account` in LLM-visible prompt strings.
**Why it's wrong:** These are retired; the CRM facade (`crm_*`) is the current contract. Legacy primitives route incorrectly or error.
**Do this instead:** Use `crm_list_create`, `crm_list_member_add`, `crm_account_get` — declared in SKILL.md "Tool discipline" section. CI gate in `extension-kind-gate.mjs` will fail the build if banned primitives appear.

### Calling `crm_list_create` before Gate 2 approves

**What happens:** Materializing the CRM list before operator reviews `memberRefs`.
**Why it's wrong:** Creates unreviewable side effects; violates the HITL gate contract.
**Do this instead:** Always wait for `approved === true` from Gate 2 before calling `crm_list_create` (SKILL.md Step 7).

### Dispatching child agents directly via primitive calls

**What happens:** Calling child agent logic outside of `agent_run`.
**Why it's wrong:** Bypasses the Cinatra agent execution model; children must be invoked through `agent_run` after resolving `templateId` via `agent_list`.
**Do this instead:** `agent_list({ packageName })` → `agent_run({ templateId, inputParams })` → poll `agent_run_get`.

## Error Handling

**Strategy:** Best-effort for individual rows (Steps 4-5); hard-abort for structural failures (gates rejected, scrape 0 items, CRM list creation failed).

**Patterns:**
- Individual row failures append `{ rowIndex, stage, error }` to `failures[]` and continue
- Structural failures return immediately with error envelope: `{ listId: "", memberCount: 0, ..., failures, summary }`
- `crm_list_member_add` failures per member are best-effort; the list exists regardless

## Cross-Cutting Concerns

**Logging:** Not applicable — no application code. The Cinatra runtime's audit log captures `agent_run_id` provenance.
**Validation:** `targetMemberType` validated at Step 1 (LLM prompt rule); OAS banned-primitive validation at CI time (`extension-kind-gate.mjs`).
**Authentication:** Not applicable at this layer — handled by Cinatra platform (MCP tool injection, `/api/llm-bridge` auth).

---

*Architecture analysis: 2026-06-09*
