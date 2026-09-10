// Lifecycle D W8 — the list curator's own steps (cinatra#3096 items 11, 12, 19).
//
// The two reviews this agent advertises were a PROMISE: the flow held one step
// and asked the model to "pause" mid-answer. A promise a run cannot keep is not
// a review. These tests hold the flow to real pauses, placed where they guard
// what they claim to guard — the list's creation and its membership.

import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));
const oas = read("cinatra/oas.json");
const pkg = read("package.json");

const refs = oas.$referenced_components;
const nodesOfType = (type) => Object.values(refs).filter((n) => n.component_type === type);
const edges = (oas.control_flow_connections ?? []).map((e) => [e.from_node.$component_ref, e.to_node.$component_ref]);
const hasEdge = (from, to) => edges.some(([f, t]) => f === from && t === to);
const dataEdges = (oas.data_flow_connections ?? []).map((e) => [
  e.source_node.$component_ref + "." + e.source_output,
  e.destination_node.$component_ref + "." + e.destination_input,
]);
const hasDataEdge = (from, to) => dataEdges.some(([f, t]) => f === from && t === to);

/** Every node id reachable from start, in the order the run walks them. */
function walk() {
  const order = [];
  const seen = new Set();
  let cursor = [oas.start_node.$component_ref];
  while (cursor.length) {
    const next = [];
    for (const id of cursor) {
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
      for (const [f, t] of edges) if (f === id) next.push(t);
    }
    cursor = next;
  }
  return order;
}

// ---------------------------------------------------------------------------
// (11) the two promised reviews made real pauses
// ---------------------------------------------------------------------------

test("(11) the two reviews are real pauses, not a promise inside one step", () => {
  const pauses = nodesOfType("InputMessageNode");
  assert.equal(pauses.length, 2, "the run does not stop twice");
  const screens = pauses.map((p) => p.metadata.cinatra.renderer);
  assert.deepEqual(screens.sort(), [...oas.metadata.cinatra.hitlScreens].sort());
  for (const pause of pauses) {
    assert.equal(pause.metadata.cinatra.requiresApproval, true, `the "${pause.id}" pause asks for no approval`);
    assert.deepEqual(pause.metadata.cinatra.inputMessageSchema.properties.decision.enum, ["approve", "revise", "reject"]);
  }
});

test("(11) the list approval guards the list's creation and its membership", () => {
  const order = walk();
  const gate = order.indexOf("list_gate");
  const create = order.indexOf("create");
  assert.ok(gate > -1, "the list approval is missing");
  assert.ok(create > gate, "the list is created before the person approves it");
  assert.ok(hasEdge("list_gate", "create"), "nothing connects the approval to the creation");
  const createNode = refs.create;
  const body = JSON.stringify(createNode.data);
  assert.match(body, /crm_list_create/, "the creation step does not create the list");
  assert.match(body, /crm_list_member_add/, "the creation step does not add the members");
  for (const other of Object.values(refs)) {
    if (other.component_type !== "ApiNode" || other.id === "create") continue;
    assert.ok(
      !/crm_list_create|crm_list_member_add/.test(JSON.stringify(other.data ?? {})),
      `the "${other.id}" step writes the list ahead of the approval`,
    );
  }
});

test("(11) the scrape schema is approved before anything is collected", () => {
  const order = walk();
  assert.ok(order.indexOf("schema_gate") < order.indexOf("collect"), "collection starts before the schema is approved");
  assert.ok(hasEdge("propose", "schema_gate"));
  assert.ok(hasEdge("schema_gate", "collect"));
  const gate = refs.schema_gate;
  assert.ok(gate.metadata.cinatra.inputMessageSchema.properties.outputSchema, "the schema review is not fed the schema");
  assert.ok(hasDataEdge("propose.outputSchema", "schema_gate.outputSchema"));
});

test("(11) the seeds, the member kind and the list name are fields the person may set", () => {
  const hidden = refs.start.metadata.cinatra.hidden ?? [];
  for (const field of ["seedUrls", "targetMemberType", "listName"]) {
    assert.ok(!hidden.includes(field), `${field} is still hidden from the person`);
    assert.ok(refs.start.inputs.some((i) => i.title === field), `the start form does not carry ${field}`);
  }
});

// ---------------------------------------------------------------------------
// (12) the dispatch primitives declared as consumed
// ---------------------------------------------------------------------------

test("(12) the primitives this agent dispatches with are declared as consumed", () => {
  const declared = new Set((pkg.cinatra.consumes ?? []).map((c) => c.primitive));
  for (const primitive of ["agent_list", "agent_run", "agent_run_get"]) {
    assert.ok(declared.has(primitive), `${primitive} is used but not declared as consumed`);
  }
});

test("(12) every primitive the flow reaches for is declared as consumed", () => {
  const declared = new Set((pkg.cinatra.consumes ?? []).map((c) => c.primitive));
  const body = JSON.stringify(oas);
  for (const primitive of ["crm_account_get", "crm_list_create", "crm_list_member_add", "agent_list", "agent_run", "agent_run_get"]) {
    if (body.includes(primitive)) assert.ok(declared.has(primitive), `${primitive} is reached for but not declared`);
  }
});

// ---------------------------------------------------------------------------
// (19) a plain-language ending on an empty or failed curation
// ---------------------------------------------------------------------------

test("(19) an empty or failed curation ends in plain language", () => {
  const summary = refs.curation_summary;
  assert.ok(summary, "the run has no closing statement");
  assert.equal(summary.component_type, "OutputMessageNode");
  assert.ok(hasEdge("create", "curation_summary") && hasEdge("curation_summary", "end"));
  assert.match(summary.message, /nothing|no one|no members/i, "an empty curation has no plain-language ending");
  assert.match(summary.message, /could not|failed/i, "a failed curation has no plain-language ending");
});
