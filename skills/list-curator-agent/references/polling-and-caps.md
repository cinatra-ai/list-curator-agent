# Polling Protocol and Defensive Caps

Reference for agent_run_get polling behaviour and operational caps used throughout the list-curator orchestrator.

## Polling protocol

Applied to every `agent_run_get` call in Steps 3, 4, and 5.

| Parameter | Value |
|---|---|
| Cadence | 5 s between polls (minimum 3 s) |
| Max cycles per child | 60 (= 5-minute cap) |
| Terminal statuses | `"completed"`, `"failed"` |
| Continuing statuses | `"queued"`, `"running"` |
| Stuck threshold | `"pending_approval"` for more than 30 s (6 cycles) |

On stuck (`pending_approval` for more than 6 cycles): append to `failures[]` and CONTINUE. The list-curator does NOT auto-resume child HITLs in v1.

## Defensive caps

| Cap | Value | Applied at |
|---|---|---|
| Scrape `maxUrls` | 50 | Step 3 `agent_run` inputParams |
| Contact-discovery `maxContacts` | 3 per accountId | Step 5 `agent_run` inputParams |
| Polling cap per child | 60 cycles x 5 s = 5 min | Steps 3, 4, 5 |
| Total rows processed | No cap (operators control via `maxUrls` at Gate 1) | Steps 4, 5 |

## Abort vs. continue conditions

Individual row failures in Steps 4 and 5 capture in `failures[]` and continue. The orchestrator aborts only on:

1. Gate 1 rejected (Step 2).
2. Scrape child `status === "failed"` (Step 3).
3. Scrape returns 0 items (Step 3).
4. Gate 2 rejected (Step 6).
5. Step 6 yields `memberCount === 0`.
6. `crm_list_create` throws (Step 7a) — cannot add members without a list.

## Scope notes

- `"mixed"` member type is not supported — CRM lists (Twenty Views) are scoped to a single object type. Step 1 rejects it immediately.
- `sourceAgentRuns` provenance is not modeled by `crm_list_create` in the current CRM contract. The agent's return envelope includes the `agent_run_id` indirectly via the runtime's audit log; explicit list-level provenance is not planned for the current release.
- List creation is non-atomic: separate `crm_list_create` + N x `crm_list_member_add`. Partial-member failures are surfaced in `failures[]`; the list exists in the CRM with whatever members succeeded. Operators can re-add failed members via the Twenty UI.
