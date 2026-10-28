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
//   - a decision the branch does not know goes where reject goes.
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
 * answer feeds a step whose output feeds the BranchingNode's input.
 */
function branchOf(gateId) {
  const readers = data
    .filter((e) => e.source_node.$component_ref === gateId && e.source_output === "userResponse")
    .map((e) => e.destination_node.$component_ref);
  for (const reader of readers) {
    const branch = data
      .filter((e) => e.source_node.$component_ref === reader)
      .map((e) => refs[e.destination_node.$component_ref])
      .find((n) => n?.component_type === "BranchingNode");
    if (branch) return { reader: refs[reader], branch };
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
      const outgoing = control.filter((e) => e.from_node.$component_ref === node.id);
      expect(outgoing.map((e) => e.to_node.$component_ref)).toEqual([found.reader.id]);
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

    it("sends a decision it does not know where reject goes", () => {
      const { branch } = branchOf(review(gate.suffix).id);
      expect(target(branch.id, "default")).toBe(target(branch.id, "reject"));
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

describe("the decision step reads every answer shape the host sends", () => {
  it("reads the decision field, the legacy refusal and the host's refusal marker", () => {
    for (const gate of GATES) {
      const { reader } = branchOf(review(gate.suffix).id);
      expect(reader.component_type).toBe("PluginTemplateNode");
      const template = String(reader.template);
      for (const literal of ['"decision":"reject"', '"decision":"revise"', '"approved":false', "[Rejectedbyoperator]"]) {
        expect(template, `the ${gate.name}'s decision step does not read ${literal}`).toContain(literal);
      }
      // Spaces and escaping backslashes are removed before the comparison, so
      // an answer wrapped in the attachment envelope reads the same.
      expect(template).toMatch(/replace\(' ', ''\)/);
      expect(template).toMatch(/replace\('\\\\', ''\)/);
    }
  });
});

describe("the list review says what the flow keeps", () => {
  const node = review(":final-list-review");

  it("no longer promises that nothing is written before the approval", () => {
    expect(node.metadata.cinatra.description).not.toMatch(/Nothing is written to the CRM before you approve/);
  });

  it("shows the list name as a fact the reviewer cannot change", () => {
    expect(node.metadata.cinatra.inputMessageSchema.properties.listName.readOnly).toBe(true);
  });
});
