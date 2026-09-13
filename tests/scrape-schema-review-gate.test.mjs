// The scrape-schema-review gate, and the version the gated flow ships under.
//
// The measured defect (issue 55): a run started through the product's own road
// reached `completed` at once with `{listId: "", memberCount: 0,
// accountsCreated: 0}` and a summary that merely NARRATED the gate ("Gate 1
// approval required before scraping. Proposed scrape-schema-review payload:
// ..."). That narration is the signature of the PRE-GATE single-node flow —
// one ApiNode whose prompt told a model to "pause at HITL Gate 1", which a
// single model turn cannot do, so it wrote the payload into its answer and the
// run finished with nothing written.
//
// The gated flow that replaces it (start -> propose -> schema_gate -> collect
// -> list_gate -> create -> curation_summary -> end) already lives in
// cinatra/oas.json. What kept it from ever reaching a run is the VERSION: the
// single-node tree was published as 0.2.0, the package registry is immutable
// (`unpublish: nobody`), and the gated tree carried the SAME 0.2.0 — so every
// install kept resolving the old tarball. The first test below is therefore
// the one that fails on the previous head; the rest hold the gate's shape and
// the prompt prose so the narrated-gate flow cannot come back.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const oas = JSON.parse(readFileSync(path.join(packageRoot, "cinatra", "oas.json"), "utf8"));
const components = oas["$referenced_components"];

/** The last version published from the pre-gate single-node tree. */
const NARRATED_GATE_VERSION = [0, 2, 0];

function semver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(value));
  if (!match) throw new Error(`version "${value}" is not a semver triple`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isAfter(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function componentsOfType(type) {
  return Object.entries(components).filter(([, node]) => node.component_type === type);
}

function gateByRenderer(suffix) {
  const found = componentsOfType("InputMessageNode").filter(([, node]) =>
    String(node.metadata?.cinatra?.renderer ?? "").endsWith(suffix),
  );
  expect(found.length, `exactly one ${suffix} gate`).toBe(1);
  return found[0];
}

/** Every node id reachable from `from` over control-flow edges, `without` removed. */
function reachable(from, without) {
  const edges = oas.control_flow_connections.filter(
    (e) => e.from_node.$component_ref !== without && e.to_node.$component_ref !== without,
  );
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const edge of edges) {
      if (edge.from_node.$component_ref !== current) continue;
      const next = edge.to_node.$component_ref;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

describe("the version the gated flow ships under", () => {
  it("is ahead of the version the narrated-gate tree was published as", () => {
    expect(
      isAfter(semver(manifest.version), NARRATED_GATE_VERSION),
      `version ${manifest.version} was already published from the pre-gate tree; ` +
        "the registry is immutable, so the gated flow can only reach a run under a new version",
    ).toBe(true);
  });
});

describe("the scrape-schema-review gate", () => {
  it("is an approval gate the run parks on, with one string resume output", () => {
    const [, gate] = gateByRenderer(":scrape-schema-review");
    expect(gate.component_type).toBe("InputMessageNode");
    expect(gate.metadata.cinatra.requiresApproval).toBe(true);
    expect(gate.outputs).toHaveLength(1);
    expect(gate.outputs[0].type).toBe("string");
  });

  it("carries the proposed payload the reviewer approves", () => {
    const [gateId, gate] = gateByRenderer(":scrape-schema-review");
    const schema = gate.metadata.cinatra.inputMessageSchema;
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["outputSchema", "seedUrls", "plan", "decision"]),
    );
    expect(schema.required).toContain("decision");
    const fed = oas.data_flow_connections
      .filter((e) => e.destination_node.$component_ref === gateId)
      .map((e) => e.destination_input);
    expect(fed).toEqual(expect.arrayContaining(["outputSchema", "seedUrls", "plan"]));
  });

  it("is the only road to the step that scrapes and to the step that writes", () => {
    const [gateId] = gateByRenderer(":scrape-schema-review");
    const [listGateId] = gateByRenderer(":final-list-review");
    const start = oas.start_node.$component_ref;
    const withoutSchemaGate = reachable(start, gateId);
    expect(withoutSchemaGate.has("collect")).toBe(false);
    expect(withoutSchemaGate.has("create")).toBe(false);
    const withoutListGate = reachable(start, listGateId);
    expect(withoutListGate.has("create")).toBe(false);
  });
});

describe("the run's own output", () => {
  it("carries listId, memberCount and accountsCreated from the writing step", () => {
    const write = components.create;
    expect(write.component_type).toBe("ApiNode");
    const produced = write.outputs.map((o) => o.title);
    expect(produced).toEqual(expect.arrayContaining(["listId", "memberCount", "accountsCreated"]));
    for (const title of ["listId", "memberCount", "accountsCreated"]) {
      const edge = oas.data_flow_connections.find(
        (e) =>
          e.source_node.$component_ref === "create" &&
          e.source_output === title &&
          e.destination_node.$component_ref === "end" &&
          e.destination_input === title,
      );
      expect(edge, `create.${title} reaches the run's own output`).toBeTruthy();
    }
    const declared = oas.outputs.map((o) => o.title);
    expect(declared).toEqual(expect.arrayContaining(["listId", "memberCount", "accountsCreated"]));
  });

  it("is never a step prompt asked to narrate an approval instead of parking", () => {
    const narration = /approval required|pause (?:at|for)[^.]{0,40}gate|gate \d/i;
    for (const [id, node] of componentsOfType("ApiNode")) {
      for (const field of ["system", "user"]) {
        const prose = String(node.data?.[field] ?? "");
        expect(narration.test(prose), `${id}.data.${field} narrates a gate: ${prose}`).toBe(false);
      }
    }
  });
});
