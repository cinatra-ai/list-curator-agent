// W8 (cinatra#3096) item (11) — the inputs a person sets are drawn on the setup form.
// The setup form draws the fields named in metadata.cinatra.required; a field
// left out of both lists is never shown and never prompted for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(path.join(root, "cinatra/oas.json"), "utf8"));
const start = oas.$referenced_components.start;
const meta = start.metadata.cinatra;

function covers() {
  const declared = new Set([...(meta.required ?? []), ...(meta.hidden ?? [])]);
  return start.inputs.map((i) => i.title).filter((t) => !declared.has(t));
}

test("(11) the seeds, the member kind and the list name are drawn on the setup form", () => {
  for (const field of ["seedUrls", "targetMemberType", "listName"]) {
    assert.ok((meta.required ?? []).includes(field), `${field} is not drawn on the setup form`);
    assert.ok(!(meta.hidden ?? []).includes(field), `${field} is hidden from the person`);
  }
});

test("every setup input is either drawn or declared as plumbing", () => {
  assert.deepEqual(covers(), [], "these inputs are in neither required nor hidden");
});
