# List Curator Agent

Turn a natural-language ask like "Y Combinator W24 batch — get founder contacts" into a clean, reviewed CRM list. The agent proposes seed sources and a scrape plan, pauses for your approval (Gate 1), runs web scraping and company/contact discovery, then pauses again for a final review (Gate 2) before creating the list and adding members.

**Install and configure:** publish to your Cinatra marketplace and install from the Extensions hub. Child agents are resolved at run time — no extra credentials needed beyond a connected workspace. Required input: `intent` (plain-language description). Optional: `seedUrls`, `targetMemberType` (`"contact"` or `"account"`, default `"contact"`), `listName`. Passing `"mixed"` as `targetMemberType` returns an error envelope immediately.

**Usage example:** set `intent` to `"Series A AI startups in Europe — get founder contacts"`. At Gate 1 review the scrape plan and seed URLs. At Gate 2 review the assembled member list; on approval the agent creates the list and adds each member. Outputs: `listId`, `memberCount`, `accountsCreated`, `contactsCreated`, `failures[]`, `summary`.

**Development:** run `node extension-kind-gate.mjs --package-root .` to validate the manifest and README. Orchestration logic: `skills/list-curator-agent/SKILL.md`; flow definition: `cinatra/oas.json`.

**Troubleshooting:** `failures[]` entries capture per-row errors without aborting the run. `stage: "gate-1"` or `"gate-2"` means the operator rejected at a checkpoint. `stage: "crm-list-create"` means list creation failed and `listId` will be empty.

## Works with

- Cinatra platform (agent runtime, MCP tool injection, HITL interrupt screens)
- `@cinatra-ai/web-scrape-agent` — crawls seed URLs and extracts structured rows
- `@cinatra-ai/company-discovery-agent` — resolves rows into CRM account records
- `@cinatra-ai/contact-discovery-agent` — finds contacts for each discovered account

## Capabilities

- Derive seed URLs and a scrape plan from a plain-language intent, with operator review at Gate 1
- Run web scraping and company discovery end to end in best-effort mode
- Run contact discovery per account when `targetMemberType` is `"contact"`
- Present the assembled member list for operator approval at Gate 2 before list creation and member adds
- Create a typed CRM list (`"account"` or `"contact"`) and add all approved members
- Surface per-row failures in the response envelope without aborting the whole run
