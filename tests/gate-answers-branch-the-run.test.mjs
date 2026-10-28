// The answer given at a review decides what the run does next (issue 65).
//
// The measured defect: both reviews were followed by an unconditional edge, so
// the answer changed nothing. A reject at the schema review still read the
// pages and collected the members; a reject at the list review still created
// the CRM list and added its members; a revise carried on as an approval and
// the note was lost.
//
// These tests hold the flow to the answer:
//   - each review's one string answer is read by a step that names the
//     decision, and a BranchingNode routes the run on that decision;
//   - reject ends the run: no path from the reject branch reaches the step the
//     review guards;
//   - revise returns the run to the step that proposes the values, with the
//     answer (and the note in it) handed to that step;
//   - approve, and only approve, reaches the guarded step;
//   - a decision the branch does not know ends the run too, with its own
//     closing message: the answer was not understood.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const oas = JSON.parse(readFileSync(path.join(packageRoot, "cinatra", "oas.json"), "utf8"));
const refs = oas.$referenced_components;
const control = oas.control_flow_connections ?? [];
const data = oas.data_flow_connections ?? [];
const endId = Object.values(refs).find((n) => n.component_type === "EndNode")?.id;

/** The review whose screen ends with `suffix`. */
function review(suffix) {
  const found = Object.values(refs).filter(
    (n) => n.component_type === "InputMessageNode" && String(n.metadata?.cinatra?.renderer ?? "").endsWith(suffix),
  );
  expect(found, `exactly one ${suffix} review`).toHaveLength(1);
  return found[0];
}

/**
 * The BranchingNode that routes the run on a review's answer: the review's
 * answer feeds the wrap step, whose output feeds the parse step, whose verdict
 * feeds the decision step, whose output feeds the BranchingNode's input.
 */
function branchOf(gateId) {
  const after = (nodeId, output) =>
    data.filter((e) => e.source_node.$component_ref === nodeId && (output === undefined || e.source_output === output));
  for (const toWrap of after(gateId, "userResponse")) {
    const wrap = refs[toWrap.destination_node.$component_ref];
    if (wrap?.component_type !== "PluginTemplateNode" || toWrap.destination_input !== "answer") continue;
    const toParse = after(wrap.id, "output");
    if (toParse.length !== 1 || toParse[0].destination_input !== "text") continue;
    const parser = refs[toParse[0].destination_node.$component_ref];
    if (parser?.component_type !== "PluginExtractNode") continue;
    const toReader = after(parser.id, "verdict");
    if (toReader.length !== 1 || toReader[0].destination_input !== "verdict") continue;
    const reader = refs[toReader[0].destination_node.$component_ref];
    const branch = after(reader?.id)
      .map((e) => refs[e.destination_node.$component_ref])
      .find((n) => n?.component_type === "BranchingNode");
    if (reader && branch) return { wrap, parser, reader, branch };
  }
  return null;
}

/** The node a branch of a BranchingNode leads to. */
function target(branchId, branchName) {
  const edges = control.filter((e) => e.from_node.$component_ref === branchId && e.from_branch === branchName);
  expect(edges, `branch "${branchName}" of ${branchId} has one edge`).toHaveLength(1);
  return edges[0].to_node.$component_ref;
}

/** Every node reachable from `from` over control-flow edges. */
function reachable(from) {
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of control) {
      if (edge.from_node.$component_ref !== current) continue;
      const next = edge.to_node.$component_ref;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}

/** The value a BranchingNode routes a decision to: its mapping, else "default". */
function routed(branch, decision) {
  return branch.mapping?.[decision] ?? "default";
}

const GATES = [
  { name: "schema review", suffix: ":scrape-schema-review", guarded: "collect", proposer: "propose" },
  { name: "list review", suffix: ":final-list-review", guarded: "create", proposer: "collect" },
];

for (const gate of GATES) {
  describe(`the ${gate.name} decides what the run does next`, () => {
    it("routes the run on the decision read from the answer", () => {
      const node = review(gate.suffix);
      const found = branchOf(node.id);
      expect(found, `no BranchingNode routes the run on the ${gate.name}'s answer`).not.toBeNull();
      // Between the review and the decision step run only the wrap step and
      // the parse step of the same answer, in that order.
      const chain = [];
      let step = node.id;
      while (step !== found.reader.id) {
        const outgoing = control.filter((e) => e.from_node.$component_ref === step);
        expect(outgoing, `${step} has one way on`).toHaveLength(1);
        step = outgoing[0].to_node.$component_ref;
        chain.push(step);
        expect(chain.length).toBeLessThan(4);
      }
      expect(chain).toEqual([found.wrap.id, found.parser.id, found.reader.id]);
      expect(control.some((e) => e.from_node.$component_ref === found.reader.id && e.to_node.$component_ref === found.branch.id)).toBe(true);
      for (const decision of ["approve", "revise", "reject"]) {
        expect(routed(found.branch, decision), `"${decision}" has no branch of its own`).toBe(decision);
        expect(found.branch.branches).toContain(decision);
      }
    });

    it(`ends the run on reject: ${gate.guarded} does not start`, () => {
      const { branch } = branchOf(review(gate.suffix).id);
      const after = reachable(target(branch.id, "reject"));
      expect(after.has(gate.guarded), `a reject still reaches ${gate.guarded}`).toBe(false);
      expect(after.has("create"), "a reject still reaches the step that writes the CRM").toBe(false);
      expect(after.has(endId), "a reject does not end the run").toBe(true);
    });

    it(`ends the run on a decision it does not know: ${gate.guarded} does not start`, () => {
      const { branch } = branchOf(review(gate.suffix).id);
      const ending = target(branch.id, "default");
      expect(ending, "the default branch has a closing message of its own").not.toBe(target(branch.id, "reject"));
      expect(refs[ending].component_type).toBe("OutputMessageNode");
      expect(refs[ending].message).toMatch(/not understood/);
      expect(refs[ending].message).not.toMatch(/declined/i);
      const after = reachable(ending);
      expect(after.has(gate.guarded)).toBe(false);
      expect(after.has("create")).toBe(false);
      expect(after.has(endId)).toBe(true);
    });

    it(`returns the run to ${gate.proposer} on revise`, () => {
      const { branch } = branchOf(review(gate.suffix).id);
      expect(target(branch.id, "revise")).toBe(gate.proposer);
    });

    it(`hands the answer, and the note in it, to ${gate.proposer}`, () => {
      const node = review(gate.suffix);
      const edge = data.find(
        (e) =>
          e.source_node.$component_ref === node.id &&
          e.source_output === "userResponse" &&
          e.destination_node.$component_ref === gate.proposer,
      );
      expect(edge, `the ${gate.name}'s answer does not reach ${gate.proposer}`).toBeTruthy();
      const proposer = refs[gate.proposer];
      const input = proposer.inputs.find((i) => i.title === edge.destination_input);
      expect(input, `${gate.proposer} declares no input for the answer`).toBeTruthy();
      expect(input.default, "the first pass carries no answer yet, so the input needs a default").toBe("");
      expect(proposer.data.user).toContain(`{{ ${edge.destination_input} }}`);
      expect(proposer.data.system).toMatch(/note/i);
    });

    it(`reaches ${gate.guarded} on approve, and only on approve`, () => {
      const node = review(gate.suffix);
      const { branch } = branchOf(node.id);
      expect(target(branch.id, "approve")).toBe(gate.guarded);
      const into = control.filter((e) => e.to_node.$component_ref === gate.guarded);
      const allowed = into.filter((e) => e.from_node.$component_ref === branch.id && e.from_branch === "approve");
      const revisit = into.filter((e) => e.from_branch === "revise");
      expect(into.length, `${gate.guarded} is entered by another edge`).toBe(allowed.length + revisit.length);
      expect(into.some((e) => e.from_node.$component_ref === node.id), `an unconditional edge runs from the ${gate.name}`).toBe(false);
    });
  });
}

describe("the decision step reads the parsed answer", () => {
  // What each answer does to the run is driven step by step in
  // gate-answers-drive-the-run.test.mjs; these cases name where it is read.
  it("hands the whole answer to the parse step as one JSON string without a code fence", () => {
    for (const gate of GATES) {
      const { wrap } = branchOf(review(gate.suffix).id);
      expect(wrap.inputs.map((i) => i.title)).toEqual(["answer"]);
      expect(wrap.template).toBe(`{"answer": {{ answer | tojson | replace('\`', '\\\\u0060') }} }`);
    }
  });

  it("takes the verdict from a parse step that reads that answer, and nothing else", () => {
    for (const gate of GATES) {
      const { parser, reader } = branchOf(review(gate.suffix).id);
      expect(reader.component_type).toBe("PluginTemplateNode");
      expect(reader.inputs.map((i) => [i.title, i.default])).toEqual([["verdict", ""]]);
      expect(Object.keys(parser.output_values)).toEqual(["verdict"]);
      expect(parser.outputs.map((o) => [o.title, o.default])).toEqual([["verdict", ""]]);
      expect(data.filter((e) => e.destination_node.$component_ref === parser.id).map((e) => e.destination_input)).toEqual(["text"]);
      expect(data.filter((e) => e.destination_node.$component_ref === reader.id).map((e) => e.source_node.$component_ref)).toEqual([parser.id]);
    }
  });

  it("passes on approve, revise and reject only, and gives anything else a value the branch does not map", () => {
    for (const gate of GATES) {
      const { reader, branch } = branchOf(review(gate.suffix).id);
      const template = String(reader.template);
      for (const decision of ["approve", "revise", "reject"]) {
        expect(template).toContain(`if verdict == '${decision}' -%}${decision}`);
      }
      expect(template).toContain("{%- else -%}unknown{%- endif -%}");
      expect(routed(branch, "unknown")).toBe("default");
    }
  });
});

describe("the list review says what the flow keeps", () => {
  const node = review(":final-list-review");

  it("no longer promises that nothing is written before the approval", () => {
    expect(node.metadata.cinatra.description).not.toMatch(/Nothing is written to the CRM before you approve/);
  });

  it("declares the list name read-only in the review's input schema", () => {
    expect(node.metadata.cinatra.inputMessageSchema.properties.listName.readOnly).toBe(true);
  });
});
