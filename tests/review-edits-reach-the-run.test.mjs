// An edit made at a review reaches the step that uses it (issue 70).
//
// The measured defect: the scrape-plan review lets the person edit the
// instructions, the output schema and the seed URLs, and the list review lets
// the person edit the list name. The answer carried the edits, but `collect`
// took its values from `propose` and `create` took the name from `start`, and
// the parse steps returned only the verdict. So an edit changed nothing, and
// nothing said so.
//
// tests/gate-answers-drive-the-run.test.mjs drives the edited approves through
// the flow (the fixture's "edits:" scenarios name the values that `collect` and
// `create` receive). These tests hold the shape that those runs rest on.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(path.join(packageRoot, "cinatra", "oas.json"), "utf8"));
const refs = oas.$referenced_components;
const edges = oas.data_flow_connections;

/** The sources of the data edges into an input of a step, as "node.output". */
const sourcesOf = (node, input) =>
  edges
    .filter((e) => e.destination_node.$component_ref === node && e.destination_input === input)
    .map((e) => `${e.source_node.$component_ref}.${e.source_output}`);

/** Every node reachable from the start over control-flow edges, without `removed`. */
function reachableWithout(removed) {
  const from = oas.start_node.$component_ref;
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const e of oas.control_flow_connections) {
      if (e.from_node.$component_ref !== current) continue;
      const next = e.to_node.$component_ref;
      if (next !== removed && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

const WIRED = [
  {
    parse: "schema_decision_parse",
    step: "collect",
    inputs: ["seedUrls", "outputSchema", "instructions"],
    fallback: { seedUrls: [], outputSchema: {}, instructions: "" },
  },
  { parse: "list_decision_parse", step: "create", inputs: ["listName"], fallback: { listName: "" } },
];

describe("the step behind a review takes its values from the answer", () => {
  for (const { parse, step, inputs } of WIRED) {
    for (const input of inputs) {
      it(`${step}.${input} has the one source ${parse}.${input}`, () => {
        expect(sourcesOf(step, input)).toEqual([`${parse}.${input}`]);
      });
    }

    it(`${step} has no road that goes around ${parse}`, () => {
      expect(reachableWithout(parse).has(step)).toBe(false);
    });
  }

  it("names every value in the prompt of the step that uses it", () => {
    for (const { step, inputs } of WIRED) {
      for (const input of inputs) expect(refs[step].data.user).toContain(`{{ ${input} }}`);
    }
  });

  it("tells collect to use the instructions the person gave", () => {
    const input = refs.collect.inputs.find((i) => i.title === "instructions");
    expect(input?.type).toBe("string");
    expect(refs.collect.data.system).toMatch(/instructions the person gave/);
  });
});

describe("the parse step gives a value for every output on a text it reads", () => {
  // The pinned runtime fills an output that its jq program did not give with the
  // output's default, and refuses a step output with no default.
  for (const { parse, inputs, fallback } of WIRED) {
    it(`${parse} declares ${inputs.join(", ")} beside the verdict, each with a default`, () => {
      const node = refs[parse];
      expect(Object.keys(node.output_values)).toEqual(["verdict", ...inputs]);
      expect(node.outputs.map((o) => o.title)).toEqual(["verdict", ...inputs]);
      for (const input of inputs) {
        expect(node.outputs.find((o) => o.title === input).default).toEqual(fallback[input]);
      }
    });
  }

  it("hands the wrap step the same values that the review showed", () => {
    for (const field of ["seedUrls", "outputSchema"]) {
      expect(sourcesOf("schema_answer_wrap", field)).toEqual([`propose.${field}`]);
      expect(sourcesOf("schema_gate", field)).toEqual([`propose.${field}`]);
    }
    expect(sourcesOf("list_answer_wrap", "listName")).toEqual(["start.listName"]);
    expect(sourcesOf("list_gate", "listName")).toEqual(["start.listName"]);
  });
});

describe("the review's input schema says what the person can edit", () => {
  const schemaOf = (id) => refs[id].metadata.cinatra.inputMessageSchema.properties;

  it("does not declare an editable value of the scrape-plan review read-only", () => {
    const props = schemaOf("schema_gate");
    for (const field of ["outputSchema", "seedUrls", "instructions"]) {
      expect(props[field], `${field} is declared`).toBeTruthy();
      expect(props[field].readOnly, `${field} is editable`).toBeUndefined();
    }
  });

  it("does not declare the list name of the list review read-only", () => {
    expect(schemaOf("list_gate").listName.readOnly).toBeUndefined();
  });

  it("keeps a value that the screen does not edit read-only", () => {
    expect(schemaOf("schema_gate").plan.readOnly).toBe(true);
    for (const field of ["candidateMembers", "dispatchedRuns", "failures"]) {
      expect(schemaOf("list_gate")[field].readOnly, field).toBe(true);
    }
  });
});
