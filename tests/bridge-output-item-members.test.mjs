// Bridge outputs declare their item members (cinatra-ai/list-curator-agent#49).
//
// The runtime asks the model for exactly the shape this agent declares: the
// loader's derivation (docker/wayflow/agent_loader.py, _derive_bridge_output_schemas)
// carries every declared member down and closes each object level. An output
// that declares a list or an object with NO member fields therefore promises
// nothing, and a structured consumer gets unfielded entries.
//
// Every bridge output of this agent is held here to ONE of the two honest
// shapes: it declares the members its consumers read, or its own `description`
// records in one sentence that the shape is intentionally free-form and why.
//
// The issue was filed against the retired single `curate` step. On this head
// that step is split into `propose` + `collect` + `create`, so the five bridge
// outputs measured free-form on this head are the ones pinned below.
import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(path.join(root, "cinatra/oas.json"), "utf8"));

// The loader's own marker words for a recorded intentional shape.
const FREEFORM_WORDS = [
  "free-form",
  "free form",
  "freeform",
  "arbitrary",
  "unstructured",
  "no fixed shape",
  "opaque",
];

function output(nodeId, title) {
  const node = oas.$referenced_components[nodeId];
  assert.ok(node, `node ${nodeId} is missing`);
  const found = (node.outputs ?? []).find((o) => o.title === title);
  assert.ok(found, `node ${nodeId} declares no output ${title}`);
  return found;
}

// Both spellings the loader accepts: a top-level key and the json_schema nesting.
function itemMembers(prop) {
  const items = prop.items ?? prop.json_schema?.items;
  assert.ok(items && !Array.isArray(items), "the output declares no items object");
  const members = items.properties ?? items.json_schema?.properties;
  assert.ok(
    members && Object.keys(members).length > 0,
    "the items object declares no member fields",
  );
  return members;
}

function assertRecordedFreeForm(prop, where) {
  const text = prop.description;
  assert.equal(typeof text, "string", `${where} carries no description`);
  assert.ok(text.trim().length > 0, `${where} carries an empty description`);
  const low = text.toLowerCase();
  assert.ok(
    FREEFORM_WORDS.some((word) => low.includes(word)),
    `${where} does not record that the shape is intentionally free-form`,
  );
}

// The consumer: FailureItem in src/list-curator-final-list-renderer.tsx reads
// {rowIndex, stage, error, accountId} off every entry of `failures`. collect's
// failures reaches that renderer through list_gate; create's echoes the same
// rows into curation_summary.
const FAILURE_MEMBERS = ["accountId", "error", "rowIndex", "stage"];

test("collect / failures declares the members its renderer reads", () => {
  const members = itemMembers(output("collect", "failures"));
  assert.deepEqual(Object.keys(members).sort(), FAILURE_MEMBERS);
});

test("create / failures declares the same members", () => {
  const members = itemMembers(output("create", "failures"));
  assert.deepEqual(Object.keys(members).sort(), FAILURE_MEMBERS);
});

test("collect / dispatchedRuns declares the shape its own system prompt names", () => {
  const members = itemMembers(output("collect", "dispatchedRuns"));
  assert.deepEqual(Object.keys(members).sort(), ["agent", "runId", "status"]);
  // The prompt is the declaration: it spells the entry out verbatim.
  const system = oas.$referenced_components.collect.data.system;
  assert.ok(
    system.includes("{runId, agent, status}"),
    "the collect prompt no longer names the dispatchedRuns entry shape",
  );
});

test("propose / outputSchema records that it is intentionally free-form", () => {
  assertRecordedFreeForm(output("propose", "outputSchema"), "propose / outputSchema");
});

test("collect / candidateMembers records that it is intentionally free-form", () => {
  assertRecordedFreeForm(
    output("collect", "candidateMembers"),
    "collect / candidateMembers",
  );
});
