# Codebase Concerns

**Analysis Date:** 2026-06-09

## Tech Debt

**Non-atomic CRM list materialization:**
- Issue: List creation is split into `crm_list_create` + N sequential `crm_list_member_add` calls with no rollback mechanism. A partial failure leaves a real list in the CRM with fewer members than intended.
- Files: `skills/list-curator-agent/SKILL.md` (Step 7, "non-atomic" note), `cinatra/oas.json`
- Impact: Operators must manually clean up or re-add missing members via the Twenty UI. Failure count is reported but recovery is not automated.
- Fix approach: Add a cleanup/rollback step that deletes the orphaned list if `addedCount / memberCount` falls below an acceptable threshold, or expose a resume-from-list-id input in a future version.

**No cap on total rows processed by the orchestrator:**
- Issue: The SKILL.md explicitly states "The orchestrator does NOT cap the total number of rows processed — operators control via `maxUrls` at Gate 1." With `maxUrls: 50` passed to the scrape child and up to 3 contacts per account, a single run can dispatch up to 50 company-discovery + 50 contact-discovery child agent runs sequentially.
- Files: `skills/list-curator-agent/SKILL.md` (Defensive caps section)
- Impact: Very long-running orchestrator sessions (50 × 60-cycle polls × 2 stages = up to ~500 minutes theoretical ceiling). Polling is sequential per child with a 5-minute cap each, meaning wall-clock time can be extremely high.
- Fix approach: Add an orchestrator-level `maxRows` cap (e.g., default 20) and/or run company-discovery child runs concurrently where the runtime supports parallel `agent_run` dispatch.

**`wasMerged` field ambiguity in accountsCreated counting:**
- Issue: The SKILL.md documents: "When `wasMerged === undefined`, assume new (`accountsCreated += 1`)". This is a fragile assumption — if the company-discovery-agent contract evolves to omit `wasMerged` in error cases or introduces new shapes, `accountsCreated` will be over-counted silently.
- Files: `skills/list-curator-agent/SKILL.md` (Step 4)
- Impact: Inaccurate `accountsCreated` in the return envelope and summary string.
- Fix approach: Treat `wasMerged === undefined` as unknown and either log a warning or require the child to always return the field.

**Gate 2 `displayName` and `accountId` grouping hints are advisory-only and not enforced:**
- Issue: The Gate 2 INTERRUPT payload shape documents `displayName` and `accountId` fields per memberRef as advisory, but the HITL renderer relies on them for UX grouping. There is no schema enforcement — if the upstream child agent omits them, the Gate 2 UI degrades silently.
- Files: `skills/list-curator-agent/SKILL.md` (HITL gate payload shapes — Gate 2)
- Impact: Operator sees memberRefs without human-readable names, reducing review quality.
- Fix approach: Populate `displayName` from the scraped row's `companyName` / contact name fields before emitting Gate 2. Add a schema field in `cinatra/oas.json` for these optional enrichment fields.

**`cinatra_run_id` internal input exposed in public OAS:**
- Issue: `cinatra/oas.json` declares `cinatra_run_id` as a named input with `default: ""`. This is an internal plumbing input (wired via data flow from start → curate node) that operators should not set directly. Exposing it in the public OAS surface creates confusion and a potential misuse vector.
- Files: `cinatra/oas.json` (lines 55–58)
- Impact: Operators could inject arbitrary run IDs, potentially confusing audit logs.
- Fix approach: Mark this input as internal/hidden in the OAS or remove it from the public inputs list, relying solely on the runtime data flow edge to wire it.

## Known Bugs

**Polling timeout surfaced as failure but execution continues (silent data loss):**
- Symptoms: If a company-discovery or contact-discovery child hits the 60-cycle poll cap, the row is appended to `failures[]` and execution CONTINUES. The `failures[]` array is the only signal — the `memberCount` in the return envelope will silently be lower than the number of scraped rows without an obvious per-row diagnostic.
- Files: `skills/list-curator-agent/SKILL.md` (Steps 4 and 5 poll timeout handling)
- Trigger: Any child agent run that exceeds 5 minutes (e.g., contact-discovery for a large company).
- Workaround: Inspect `failures[]` in the return envelope for entries with `stage: "company-discovery"` or `stage: "contact-discovery"` and `error` containing "timeout".

**`pending_approval` child HITL handled inconsistently across steps:**
- Symptoms: In Step 3 (scrape), `status === "pending_approval"` triggers an immediate error envelope and abort. In Steps 4–5 (company/contact discovery), it surfaces in `failures[]` only after >30s (6 cycles) and then CONTINUES rather than aborting. The inconsistency means a stuck scrape child halts everything, but a stuck company-discovery child is silently skipped.
- Files: `skills/list-curator-agent/SKILL.md` (Steps 3, 4, 5 `pending_approval` handling)
- Trigger: Any child agent that raises an unexpected HITL interrupt.
- Workaround: None. The list-curator explicitly documents it does not auto-resume child HITLs in v1.

## Security Considerations

**Operator-provided `seedUrls` are passed directly to the scrape child without sanitization:**
- Risk: Malicious or misconfigured `seedUrls` (e.g., internal network addresses, `file://` URIs, or SSRF-prone targets) are forwarded verbatim to the web-scrape child agent.
- Files: `skills/list-curator-agent/SKILL.md` (Step 3 — `agent_run` inputParams construction)
- Current mitigation: Gate 1 HITL gives the operator a chance to review and edit `seedUrls` before dispatch. The OAS declares `seedUrls` items as `format: "uri"` (not enforced at runtime).
- Recommendations: Add URL allowlist/denylist validation before Gate 1 (e.g., reject `file://`, `localhost`, RFC-1918 addresses). The web-scrape child should enforce this too, but defense-in-depth at the orchestrator level is valuable.

**`outputSchema` is operator-editable at Gate 1 and forwarded to the scrape child without validation:**
- Risk: A crafted `outputSchema` could instruct the scrape child to extract unexpected fields or exceed memory/processing limits.
- Files: `skills/list-curator-agent/SKILL.md` (Step 2 Gate 1, Step 3)
- Current mitigation: Gate 1 is an HITL step requiring operator approval.
- Recommendations: Validate that the `outputSchema` returned at Gate 1 is a well-formed JSON Schema object with bounded `properties` count before forwarding it.

**`.npmrc` file present:**
- Note: `.npmrc` exists in the repo root. File contents were not read. It likely contains registry configuration or auth token references. Ensure no tokens are committed in plaintext.

## Performance Bottlenecks

**Sequential child-agent dispatch in Steps 4 and 5:**
- Problem: Company-discovery runs are dispatched one-at-a-time (per scraped row), each awaiting up to 60 × 5s = 5 minutes before moving on. Contact-discovery is similarly sequential per accountId.
- Files: `skills/list-curator-agent/SKILL.md` (Steps 4 and 5)
- Cause: The SKILL.md recipe uses a per-row loop with synchronous poll-until-terminal semantics.
- Improvement path: Dispatch all company-discovery `agent_run` calls in batch, then poll all run IDs concurrently. This requires runtime support for parallel `agent_run_get` polling and is a significant orchestrator redesign.

**5-second polling interval with no exponential backoff:**
- Problem: All child poll loops use a fixed 5s cadence regardless of child run duration. Short-lived children waste cycles; very long ones accumulate many identical polls.
- Files: `skills/list-curator-agent/SKILL.md` (Polling protocol section)
- Cause: Fixed cadence defined in SKILL.md.
- Improvement path: Implement exponential backoff with a cap (e.g., 5s → 10s → 30s) for `agent_run_get` polling.

## Fragile Areas

**Slug derivation logic is defined only in prose, not in code:**
- Files: `skills/list-curator-agent/SKILL.md` (Step 7 slug derivation section)
- Why fragile: The slug algorithm ("lowercase, replace whitespace runs with `-`, strip non-alphanumeric except `-`, trim leading/trailing `-`") is described in natural language and executed by the LLM at runtime. Different LLM completions may produce slightly different slugs for the same input, leading to inconsistent CRM list slugs across runs.
- Safe modification: If a `crm_list_create` slug conflict error is encountered, the agent has no documented retry strategy. The list creation fails and the error envelope is returned.
- Test coverage: No automated tests exist for slug derivation behavior.

**`memberCount` in return envelope reflects `addedCount` (actual adds), not proposed member count:**
- Files: `skills/list-curator-agent/SKILL.md` (Step 7b, Return shape section)
- Why fragile: The SKILL.md notes this distinction explicitly, but callers (and the OAS output schema) just declare `memberCount: integer` with no clarification. A caller expecting "members in the list" vs "members proposed at Gate 2" will misinterpret partial-failure runs.
- Safe modification: Document the distinction in the OAS `outputs` description field for `memberCount`.
- Test coverage: None.

**`agent_list` is called separately before each child dispatch (3 calls total):**
- Files: `skills/list-curator-agent/SKILL.md` (Steps 3, 4, 5)
- Why fragile: `agent_list` resolves `packageName → templateId`. If the marketplace lookup is slow or intermittently fails, each of the 3 child dispatches can fail independently. There is no caching or retry documented.
- Safe modification: Resolve all three templateIds upfront (before Step 3) and cache them. Fail fast if any resolution fails before any child work begins.
- Test coverage: None.

## Scaling Limits

**CRM list member add is O(N) sequential calls:**
- Current capacity: Each member requires one `crm_list_member_add` call. With 50 scraped rows × 3 contacts each = up to 150 sequential CRM API calls in Step 7b.
- Limit: No bulk-add API is documented in the CRM facade. The current contract is "add one at a time."
- Scaling path: Requires a `crm_list_members_bulk_add` primitive in the CRM facade, or batching via the Twenty API directly.

**Total orchestrator runtime scales with N scraped rows × child poll duration:**
- Current capacity: 50 rows × (5 min company-discovery + 5 min contact-discovery) = up to 500 minutes theoretical max.
- Limit: LLM context window and runtime session timeouts.
- Scaling path: Parallel child dispatch (see Performance Bottlenecks above).

## Dependencies at Risk

**`gpt-5.5` model preference hardcoded in OAS:**
- Risk: `cinatra/oas.json` declares `"preferredModel": "gpt-5.5"`. If this model is deprecated, renamed, or rate-limited, the agent will fail or degrade without a fallback.
- Impact: All runs that rely on the preferred model selection.
- Migration plan: Make model preference configurable via an input parameter with a safe default, or remove the hardcoded preference and rely on the platform default.

**Release workflow depends on `cinatra-ai/.github` reusable workflow:**
- Risk: `.github/workflows/release.yml` references `cinatra-ai/.github/.github/workflows/reusable-extension-release.yml@main` and is documented as "dormant until the org infra exists." If the referenced reusable workflow is modified or removed, the release pipeline breaks silently.
- Impact: Marketplace publish is blocked.
- Migration plan: Pin the reusable workflow to a versioned tag rather than `@main` once the org infra is stable.

## Missing Critical Features

**No resume / retry for failed rows:**
- Problem: If a run completes with N entries in `failures[]`, there is no way to re-run only the failed rows without re-running the full orchestration (including Gate 1, the full scrape, and Gate 2).
- Blocks: Efficient recovery from partial failures in large lists.

**No provenance link between CRM list and the agent run that created it:**
- Problem: The SKILL.md explicitly notes "`sourceAgentRuns` provenance is not modeled by `crm_list_create` in the current CRM contract." The list in the CRM has no link back to the agent run.
- Blocks: Audit trail — operators cannot determine which agent run produced a given CRM list.

**`"mixed"` targetMemberType is permanently rejected with no migration path:**
- Problem: Mixed-type lists (accounts + contacts in the same list) are not supported. The SKILL.md documents this as a hard constraint tied to the CRM's per-object-type list model.
- Blocks: Use cases where a single curation produces a list of both accounts and contacts (e.g., "all YC W24 founders AND their companies").

## Test Coverage Gaps

**No tests of any kind in this repository:**
- What's not tested: All orchestrator logic — input validation, HITL gate payload construction, failure accumulation, slug derivation, memberRef shape, return envelope structure.
- Files: Entire `skills/list-curator-agent/SKILL.md` prompt (runtime LLM behavior), `extension-kind-gate.mjs` (CI gate logic), `cinatra/oas.json` (schema correctness).
- Risk: Regressions in the SKILL.md prompt (e.g., a Step 4 change that breaks `accountsCreated` counting) are undetectable without a full end-to-end run.
- Priority: High for `extension-kind-gate.mjs` (pure Node.js utility — fully unit-testable), Medium for OAS schema validation, Low for LLM prompt behavior (requires integration harness).

**`extension-kind-gate.mjs` exports are not covered by any test suite:**
- What's not tested: `validateAgent`, `validateWorkflow`, `validateBpmnSanity`, `validateWorkflowPackageShape`, `findWorkflowSidecars`, `parseArgs`.
- Files: `extension-kind-gate.mjs`
- Risk: Banned-primitive scan logic or BPMN sanity checks could silently regress.
- Priority: High — this file is pure, deterministic, and exports named functions specifically designed for testability.

---

*Concerns audit: 2026-06-09*
