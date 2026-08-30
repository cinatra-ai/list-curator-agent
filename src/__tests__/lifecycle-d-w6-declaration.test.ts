// Lifecycle D W6 — this agent's declared state, asserted on the shipped
// manifest and the shipped service description.
//
// The declaration key: a dependency is a required `kind: "artifact"` entry in
// `cinatra.dependencies`; produces is `cinatra.produces` on the manifest, which
// is the only authority the host compiler reads; a binding is an end-node
// output's `cinatra.artifact` block.
//
// 6e — the curator declares nothing. Its terminal outputs are a list id,
// counts, a failures list and a short summary, and the list itself is a CRM
// entity, not an artifact. A failures list that grows past the document floor
// lands as structured data by the default road, which needs no declaration of
// its own. The two review screens the manifest declares become real pauses in
// the flow wave, not here; this fixture states the absence so a later wave
// cannot add a declaration here without saying why.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, it, expect } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<
  string,
  any
>;
const oas = JSON.parse(readFileSync(join(root, "cinatra/oas.json"), "utf8")) as Record<
  string,
  any
>;
const cinatra = pkg.cinatra ?? {};
const components: Record<string, any> = oas.$referenced_components ?? {};

const artifactDependencies = (cinatra.dependencies ?? []).filter(
  (d: any) => d.kind === "artifact",
);
const bindings: unknown[] = [];
for (const comp of Object.values(components)) {
  if (comp?.component_type !== "EndNode") continue;
  for (const out of comp.outputs ?? []) {
    if (out?.cinatra?.artifact) bindings.push(out.cinatra.artifact);
  }
}
function startNode(): any {
  for (const comp of Object.values(components)) {
    if (comp?.component_type === "StartNode") return comp;
  }
  throw new Error("no StartNode");
}

describe("lifecycle D W6 — the curator's declared state", () => {
  it("the produces mirror agrees with the manifest, entry for entry", () => {
    const mirror = oas.metadata?.cinatra?.produces;
    if (mirror === undefined) return;
    expect(mirror).toEqual(cinatra.produces ?? []);
  });

  it("no start-node input is listed as both required and hidden", () => {
    const meta = startNode().metadata?.cinatra ?? {};
    const hidden = new Set<string>(meta.hidden ?? []);
    expect((meta.required ?? []).filter((t: string) => hidden.has(t))).toEqual([]);
  });

  it("6e — nothing declared: no produces entry, on the manifest or its mirror", () => {
    expect(cinatra.produces).toBeUndefined();
    expect(oas.metadata?.cinatra?.produces).toBeUndefined();
  });

  it("6e — nothing bound: no end-node output carries an artifact block", () => {
    expect(bindings).toEqual([]);
  });

  it("6e — no artifact dependency edge", () => {
    expect(artifactDependencies).toEqual([]);
  });
});
