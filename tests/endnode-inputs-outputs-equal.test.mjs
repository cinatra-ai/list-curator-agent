// An EndNode that declares BOTH inputs and outputs declares them EQUAL
// (cinatra-ai/list-curator-agent#51).
//
// The runtime rejects the whole package otherwise. pyagentspec 26.1.2 —
// pyagentspec/flows/nodes/endnode.py, EndNode._validate_inputs_and_outputs_are_equal
// — is the rule, verbatim:
//
//     if self.inputs and self.outputs and self.inputs != self.outputs:
//         raise ValueError(
//             "If both inputs and outputs are specified for an EndNode, they must be equal."
//         )
//
// A Property serializes to its own json schema, so two entries are equal to the
// runtime exactly when their declarations are equal — a `default` or an
// `items` shape carried on one side only is already a difference. That is what
// the tip declared: the seven outputs carried `default` (and, on the two array
// members, `json_schema.items`) while the seven same-titled inputs carried only
// `title` and `type`, so the loader refused to mount this package at all:
//
//     [agent_loader] FAILED to mount cinatra-ai/list-curator-agent:
//     ValidationError: 1 validation error for EndNode / Value error, If both
//     inputs and outputs are specified for an EndNode, they must be equal.
//
// The rule is pinned here for EVERY EndNode of the flow, in declaration ORDER
// (the runtime compares two lists, not two sets), so a later edit to one side
// cannot drift away from the other unnoticed.
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(path.join(root, "cinatra/oas.json"), "utf8"));

// Every EndNode anywhere in the document, keyed by the id the loader reports.
function endNodes(value, found = []) {
  if (Array.isArray(value)) {
    for (const entry of value) endNodes(entry, found);
    return found;
  }
  if (value && typeof value === "object") {
    if (value.component_type === "EndNode") found.push(value);
    for (const entry of Object.values(value)) endNodes(entry, found);
  }
  return found;
}

const ends = endNodes(oas);

test("the flow declares at least one EndNode", () => {
  assert.ok(ends.length > 0, "no EndNode found in cinatra/oas.json");
});

for (const node of ends) {
  const id = node.id ?? node.name ?? "(unnamed)";
  test(`EndNode ${id} declares inputs equal to its outputs`, () => {
    const inputs = node.inputs ?? [];
    const outputs = node.outputs ?? [];
    // The runtime only compares when BOTH sides are specified.
    if (inputs.length === 0 || outputs.length === 0) return;
    assert.deepEqual(
      inputs,
      outputs,
      `EndNode ${id} declares inputs that differ from its outputs, which the ` +
        `runtime refuses: "If both inputs and outputs are specified for an ` +
        `EndNode, they must be equal."`,
    );
  });
}

// The rule must not be satisfied by dropping the declarations: the seven
// values this flow ends on stay declared, in order, on both sides.
const END_TITLES = [
  "listId",
  "memberCount",
  "accountsCreated",
  "contactsCreated",
  "failures",
  "summary",
  "dispatchedRuns",
];

test("the end node still declares the seven values the flow ends on", () => {
  const end = oas.$referenced_components.end;
  assert.ok(end, "the flow declares no component `end`");
  assert.equal(end.component_type, "EndNode");
  assert.deepEqual((end.outputs ?? []).map((p) => p.title), END_TITLES);
  assert.deepEqual((end.inputs ?? []).map((p) => p.title), END_TITLES);
});
