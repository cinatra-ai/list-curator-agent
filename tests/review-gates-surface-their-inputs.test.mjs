// A review shows the person what the flow gives it (issues 70 and 72).
//
// The measured defect: on the pinned runtime a gate's input values reach the
// host only as the text of the gate's own message. The host's agent_loader
// writes that text from the inputs only for a gate that sets
// metadata.cinatra.surfaceGateInputs to true. Without it the message is empty,
// and the screen gets the run's start inputs alone: the scrape-plan review drew
// an empty schema, and a plain Approve handed that schema to `collect`, and the
// list review drew no members. A run input named like a gate's input could also
// stand in for the value.
//
// These tests hold the shape that this rests on. They do not run the loader:
// this repository has no copy of it.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(path.join(packageRoot, "cinatra", "oas.json"), "utf8"));
const refs = oas.$referenced_components;
const gates = Object.values(refs).filter((node) => node.component_type === "InputMessageNode");
const titles = (node) => node.inputs.map((input) => input.title);
const ref = (node) => node?.$component_ref ?? node?.id;
const edges = oas.data_flow_connections.map((edge) =>
  [ref(edge.source_node), edge.source_output, ref(edge.destination_node), edge.destination_input].join(" "),
);

describe("the review gates hand their inputs to the screen", () => {
  it("every review gate sets surfaceGateInputs, so that its values reach the screen", () => {
    expect(gates.map((gate) => gate.id).sort()).toEqual(["list_gate", "schema_gate"]);
    for (const gate of gates) {
      expect(gate.metadata.cinatra.surfaceGateInputs).toBe(true);
    }
  });

  it("every input of a review gate has a plain name, which the loader can write", () => {
    for (const gate of gates) {
      for (const title of titles(gate)) {
        expect(title).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
      }
    }
  });

  it("each review gate takes the values that its screen reads", () => {
    expect(titles(refs.schema_gate)).toEqual(expect.arrayContaining(["outputSchema", "seedUrls"]));
    expect(titles(refs.list_gate)).toEqual(
      expect.arrayContaining(["candidateMembers", "listName", "failures"]),
    );
  });

  it("the scrape gate takes plan from propose, the key by which its screen tells a proposal", () => {
    // The screen treats a value without `plan` as unreadable. Without this
    // input and edge the gate's message would not write `plan`, and every
    // real proposal would read as unreadable.
    expect(refs.propose.outputs.map((output) => output.title)).toContain("plan");
    expect(titles(refs.schema_gate)).toContain("plan");
    for (const key of ["outputSchema", "seedUrls", "plan"]) {
      expect(edges).toContain(`propose ${key} schema_gate ${key}`);
    }
  });

  it("the start inputs declare no key of a review gate, except the two that its message replaces", () => {
    const start = Object.values(refs).find((node) => node.component_type === "StartNode");
    const shared = titles(start).filter((title) =>
      gates.some((gate) => titles(gate).includes(title)),
    );
    expect(shared.sort()).toEqual(["listName", "seedUrls"]);
  });
});
