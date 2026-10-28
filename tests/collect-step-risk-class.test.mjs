// The step that collects the candidate members is not classed read-only
// (issue 67).
//
// `collect` dispatches the company-discovery and contact-discovery agents, and
// those can create account and contact records in the CRM before the list
// review. Both agents class the step that writes those records `write_safe` in
// their own definitions, and so does `create` in this flow. `collect` takes the
// same class. It keeps `requiresApproval: false`: the list review after it is
// the flow's pause, and the class adds none.
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(path.join(root, "cinatra", "oas.json"), "utf8"));
const refs = oas.$referenced_components;

test("collect is not classed read-only: the agents it dispatches can write CRM records", () => {
  const meta = refs.collect.metadata.cinatra;
  assert.notEqual(meta.riskClass, "read_only", "collect is classed read-only");
  assert.equal(meta.riskClass, "write_safe");
  assert.equal(meta.requiresApproval, false, "collect gained a pause of its own");
  assert.match(meta.description, /can write CRM records/, "the description no longer says why the step is not read-only");
});

test("the two steps that can write CRM records carry the same class", () => {
  for (const id of ["collect", "create"]) {
    assert.equal(refs[id].metadata.cinatra.riskClass, "write_safe", id);
  }
});
