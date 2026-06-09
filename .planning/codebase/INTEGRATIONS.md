# External Integrations

**Analysis Date:** 2026-06-09

## APIs & External Services

**Cinatra Platform (internal):**
- Cinatra LLM Bridge — routes all LLM inference for the orchestrator node
  - Endpoint: `{{CINATRA_BASE_URL}}/api/llm-bridge` (POST)
  - Auth: platform-injected (env var `CINATRA_BASE_URL`)
  - Declared in: `cinatra/oas.json` (`curate` ApiNode `url` field)

**OpenAI:**
- Used as the preferred LLM provider for the `curate` node
  - Model: `gpt-5.5`
  - Provider key: `openai`
  - Declared in: `cinatra/oas.json` `metadata.cinatra.llm` and `curate.data.cinatra_llm`
  - Auth: managed by the Cinatra LLM Bridge (not directly by this agent)

## Child Agent Integrations (MCP Primitives)

The orchestrator dispatches three child agents via Cinatra's MCP `agent_run` primitive. These are runtime dependencies resolved by `agent_list`, not package.json dependencies.

**@cinatra-ai/web-scrape-agent:**
- Purpose: Crawl seed URLs and extract structured rows per operator-approved `outputSchema`
- Invocation: `agent_run({ templateId, inputParams: { seedUrls, outputSchema, instructions, maxUrls: 50 } })`
- Returns: `{ items: Array<object> }`
- HITL screens: none (no `pending_approval` expected)
- Defined usage: `skills/list-curator-agent/SKILL.md` Step 3

**@cinatra-ai/company-discovery-agent:**
- Purpose: Resolve each scraped row into a CRM account (create or merge)
- Invocation: `agent_run({ templateId, inputParams: { companyName, domain } })`
- Returns: `{ accountId: string, wasMerged: boolean }`
- Defined usage: `skills/list-curator-agent/SKILL.md` Step 4

**@cinatra-ai/contact-discovery-agent:**
- Purpose: Find contacts (founders/CEOs/CTOs) for each resolved accountId
- Invocation: `agent_run({ templateId, inputParams: { accountId, titlePatterns, maxContacts: 3 } })`
- Returns: `{ contactIds: string[] }`
- Conditional: skipped entirely when `targetMemberType === "account"`
- Defined usage: `skills/list-curator-agent/SKILL.md` Step 5

## CRM Integration (MCP Primitives)

**Cinatra CRM Facade (Twenty CRM):**
- `crm_list_create({ slug, name, objectType })` — creates a new CRM list (View); called only after Gate 2 approval
- `crm_list_member_add({ listId, objectId, objectType })` — adds one member per call, looped; idempotent
- `crm_account_get({ id })` — defensive read for accountId validation; optional on happy path
- Note: only `"contact"` and `"account"` objectTypes are supported; `"mixed"` is rejected at Step 1
- Defined usage: `skills/list-curator-agent/SKILL.md` Steps 6–7; `cinatra/oas.json` `metadata.cinatra` description

**Agent orchestration primitives (MCP):**
- `agent_list({ packageName })` — resolve packageName → templateId for each child agent
- `agent_run({ templateId, inputParams })` — dispatch a child agent run
- `agent_run_get({ runId })` — poll a child run for terminal status; cadence 5s, max 60 cycles

## Data Storage

**Databases:**
- Twenty CRM — account and contact records are written to and read from the CRM via the Cinatra CRM facade primitives
- No direct database connection in this agent; all persistence is through MCP primitives

**File Storage:**
- Not applicable

**Caching:**
- None

## Authentication & Identity

**Auth Provider:**
- Cinatra platform — authentication for MCP primitive calls and LLM bridge is managed by the platform runtime, not by this agent directly
- No OAuth flows, JWT handling, or session management in this agent's code

## Human-in-the-Loop (HITL) Gates

**Gate 1 — scrape-schema-review:**
- Renderer: `@cinatra-ai/list-curator-agent:scrape-schema-review`
- Payload: `{ instructions, outputSchema, seedUrls }`
- Operator edits: instructions, outputSchema, seedUrls
- Declared in: `cinatra/oas.json` `metadata.cinatra.hitlScreens[0]`

**Gate 2 — final-list-review:**
- Renderer: `@cinatra-ai/list-curator-agent:final-list-review`
- Payload: `{ listName, memberRefs, memberCount, accountsCreated, contactsCreated, failures }`
- Operator edits: listName, approval decision
- Declared in: `cinatra/oas.json` `metadata.cinatra.hitlScreens[1]`

## Monitoring & Observability

**Error Tracking:**
- Not detected — failures are surfaced in the structured `failures[]` output field; no external error-tracking service integrated

**Logs:**
- Cinatra platform audit log captures `agent_run_id` for provenance; explicit list-level provenance is not modeled in the current CRM contract (noted in `skills/list-curator-agent/SKILL.md`)

## CI/CD & Deployment

**Hosting:**
- Cinatra marketplace / platform — agent is published as a package and installed/run by the Cinatra runtime

**CI Pipeline:**
- GitHub Actions — `.github/workflows/` directory present
- CI gate: `extension-kind-gate.mjs` — zero-dependency Node.js script that validates `cinatra/oas.json` shape and checks for banned CRM primitives before publish

## Environment Configuration

**Required env vars:**
- `CINATRA_BASE_URL` — base URL for the Cinatra LLM bridge (used in `cinatra/oas.json`)

**Secrets location:**
- `.npmrc` present — likely holds `@cinatra-ai` registry auth token (contents not read)

## Webhooks & Callbacks

**Incoming:**
- None — agent is invoked synchronously by the Cinatra Flow runtime

**Outgoing:**
- None — all external calls are made via MCP primitives managed by the platform

---

*Integration audit: 2026-06-09*
