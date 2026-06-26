# Return Envelope

Reference for the return shape and all error envelopes produced by the list-curator orchestrator.

## Success envelope

Returned after Step 7b completes.

```json
{
  "listId": "<crm_list_create.id>",
  "memberCount": 10,
  "accountsCreated": 8,
  "contactsCreated": 10,
  "failures": [
    {"rowIndex": 2, "stage": "company-discovery", "error": "no_domain"},
    {"rowIndex": 5, "stage": "contact-discovery", "accountId": "acc_xyz", "error": "timeout"}
  ],
  "summary": "Curated 10/12 members (8 accounts, 10 contacts) from 14 scraped rows. 2 failures."
}
```

`memberCount` reflects how many were ACTUALLY added (`addedCount`), not how many were proposed.

## Error envelopes (early exits)

All early-exit envelopes share the same shape as the success envelope but with `listId: ""` and a summary describing the exit reason.

### unsupported targetMemberType (Step 1)

```json
{
  "listId": "",
  "memberCount": 0,
  "accountsCreated": 0,
  "contactsCreated": 0,
  "failures": [{"stage": "validate", "error": "unsupported_targetMemberType"}],
  "summary": "targetMemberType must be 'contact' or 'account'. The 'mixed' variant is not supported."
}
```

### Gate 1 rejected (Step 2)

```json
{
  "listId": "",
  "memberCount": 0,
  "accountsCreated": 0,
  "contactsCreated": 0,
  "failures": [{"stage": "gate-1", "error": "rejected"}],
  "summary": "Operator rejected scrape-schema at Gate 1."
}
```

### Scrape returned zero items (Step 3)

```json
{
  "listId": "",
  "memberCount": 0,
  "accountsCreated": 0,
  "contactsCreated": 0,
  "failures": [{"stage": "web-scrape", "error": "no_items"}],
  "summary": "Scrape returned no items — nothing to curate."
}
```

### Scrape child failed (Step 3)

```json
{
  "listId": "",
  "memberCount": 0,
  "accountsCreated": 0,
  "contactsCreated": 0,
  "failures": [{"stage": "web-scrape", "error": "<agent_run failure reason>"}],
  "summary": "Web-scrape child failed — run cannot continue."
}
```

### Zero members survived all stages (Step 6)

```json
{
  "listId": "",
  "memberCount": 0,
  "accountsCreated": 3,
  "contactsCreated": 0,
  "failures": [],
  "summary": "Zero members survived all stages — nothing to materialize."
}
```

### Gate 2 rejected (Step 6)

```json
{
  "listId": "",
  "memberCount": 0,
  "accountsCreated": 8,
  "contactsCreated": 10,
  "failures": [{"stage": "gate-2", "error": "rejected"}],
  "summary": "Operator rejected final list at Gate 2."
}
```

### crm_list_create throws (Step 7a)

```json
{
  "listId": "",
  "memberCount": 0,
  "accountsCreated": 8,
  "contactsCreated": 10,
  "failures": [{"stage": "crm-list-create", "error": "<stringify error>"}],
  "summary": "Failed to create CRM list — no members were added."
}
```

## Failure object schema

Each entry in `failures[]` follows this shape:

```json
{
  "rowIndex": 2,
  "stage": "company-discovery",
  "error": "no_domain",
  "accountId": "acc_xyz",
  "contactId": "ct_abc"
}
```

Fields `rowIndex`, `accountId`, and `contactId` are optional and present only when relevant to the stage.

| stage | rowIndex | accountId | notes |
|---|---|---|---|
| `validate` | — | — | Step 1 type check |
| `gate-1` | — | — | Gate 1 rejection |
| `web-scrape` | — | — | Step 3 child failure |
| `company-discovery` | present | — | Step 4 per-row failure |
| `contact-discovery` | present | present | Step 5 per-account failure |
| `crm-list-create` | — | — | Step 7a throw |
| `crm-list-member-add` | — | — | Step 7b per-member throw |
| `gate-2` | — | — | Gate 2 rejection |

## memberRef construction

| targetMemberType | memberRefs shape | crm_list_create.objectType |
|---|---|---|
| `"account"` | `[{objectType: "account", objectId: aId}, ...]` | `"account"` |
| `"contact"` | `[{objectType: "contact", objectId: cId}, ...]` | `"contact"` |

`objectType` values are the CRM facade enum (`"contact"` or `"account"`), NOT the legacy `@cinatra-ai/entity-{accounts,contacts}:*` typeHints.
