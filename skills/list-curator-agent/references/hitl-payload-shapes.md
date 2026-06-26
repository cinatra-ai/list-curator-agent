# HITL Gate Payload Shapes

Reference for the two INTERRUPT payloads emitted by the list-curator orchestrator.

## Gate 1 — scrape-schema-review

Emitted at Step 2. The renderer reviews and edits scrape instructions, schema, and seed URLs before the web-scrape child is dispatched.

### Interrupt payload

```json
{
  "x-renderer": "@cinatra-ai/list-curator-agent:scrape-schema-review",
  "value": {
    "instructions": "<the proposed instructions>",
    "outputSchema": {
      "type": "object",
      "properties": {
        "companyName": { "type": "string" },
        "website": { "type": "string" },
        "description": { "type": "string" }
      },
      "required": ["companyName"]
    },
    "seedUrls": ["https://www.ycombinator.com/companies?batch=W24"]
  }
}
```

### Approval payload

```json
{
  "approved": true,
  "instructions": "<possibly edited>",
  "outputSchema": { "<possibly edited JSON Schema>" },
  "seedUrls": ["<possibly edited>"]
}
```

### Rejection envelope (approved !== true)

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

## Gate 2 — final-list-review

Emitted at Step 6. The renderer reviews the proposed list members and approves/edits the list name before CRM materialization.

### Interrupt payload

```json
{
  "x-renderer": "@cinatra-ai/list-curator-agent:final-list-review",
  "value": {
    "listName": "<derived or input>",
    "memberRefs": [
      {"objectType": "account", "objectId": "acc_...", "displayName": "Acme Corp"},
      {"objectType": "contact", "objectId": "ct_...", "displayName": "Jane Founder", "accountId": "acc_..."}
    ],
    "memberCount": 12,
    "accountsCreated": 10,
    "contactsCreated": 12,
    "failures": []
  }
}
```

`displayName` and `accountId` grouping hints per memberRef are advisory only — the renderer may use them for display grouping.

### Approval payload

```json
{ "approved": true, "listName": "<possibly edited>" }
```

### Rejection envelope (approved !== true)

```json
{
  "listId": "",
  "memberCount": 0,
  "accountsCreated": 12,
  "contactsCreated": 12,
  "failures": [],
  "summary": "Operator rejected final list at Gate 2."
}
```
