/**
 * THE TWO REVIEW SCREENS ARE DECLARED, AND THE PRODUCT DRAWS THEM
 * (cinatra-ai/cinatra#3470).
 *
 * An agent package does not draw its own HITL screens. It declares each screen
 * in its manifest, and the product draws it with its own components. This
 * package has two review steps, the scrape-plan review and the list review.
 * Each field-renderer binding declares `screen` with the "card" layout, and the
 * package ships no component of its own for either step.
 *
 * These arms pin:
 * - each binding declares exactly its screen and no component, and keeps the id,
 *   kind and priority the flow's gates name;
 * - every key a screen names (a section, a key an answer sends or requires, a
 *   key that makes the review unreadable) is a property or an input of the gate
 *   it draws, and an editable section is a value the gate lets a person change;
 * - each answer's decision is one the gate's decision enum lists, and the
 *   answer key is the gate's one output;
 * - the answer that the product's one Continue stages from a declared Approve
 *   (the staged object, and the JSON text of it that the gate's one output
 *   carries) is read by the flow's decision steps as an approve WITH the edits
 *   the person made, and a Reject as a reject. The flow runs of those answers
 *   are the "declared screens:" scenarios of
 *   tests/fixtures/gate-answer-scenarios.json, which
 *   tests/gate-answers-drive-the-run.test.mjs runs through the flow;
 * - the package ships nothing that draws: no renderer module, no component
 *   file, no copy of a product primitive, no React, icon or UI peer.
 *
 * The staged answer follows the product's rule for the card's one Continue:
 * the chosen answer, then the value of each key it sends, then the JSON text of
 * that object under the answer key. The product's own code is not importable
 * here, so `stage` below states the rule once.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (...parts) => JSON.parse(readFileSync(path.join(packageRoot, ...parts), "utf8"));
const manifest = readJson("package.json");
const oas = readJson("cinatra", "oas.json");
const refs = oas.$referenced_components;
const scenarios = readJson("tests", "fixtures", "gate-answer-scenarios.json");

const MAX_SCREEN_BYTES = 8192;
const EDITABLE = ["field", "textList", "json"];

const SCRAPE_SCHEMA_SCREEN = {
  layout: "card",
  title: "Review scrape schema",
  sections: [
    {
      type: "field",
      key: "instructions",
      label: "Instructions",
      multiline: true,
      optional: true,
      placeholder: "Per-row extraction instructions for the scrape child.",
    },
    {
      type: "json",
      key: "outputSchema",
      label: "Output schema (JSON Schema)",
      invalidText: "Invalid JSON",
    },
    {
      type: "textList",
      key: "seedUrls",
      label: "Seed URLs",
      web: true,
      placeholder: "https://example.com/path",
      addLabel: "Add URL",
      removeLabel: "Remove",
      removeAriaLabel: "Remove URL",
      emptyText: "No seed URLs. Add at least one to enable Approve.",
    },
  ],
  decisionsLabel: "Decision",
  decisions: [
    {
      label: "Approve",
      answer: { decision: "approve", approved: true },
      sends: ["instructions", "outputSchema", "seedUrls"],
    },
    { label: "Reject", answer: { decision: "reject", approved: false }, sends: [] },
  ],
  unreadable: { keys: ["plan", "outputSchema"], text: "The proposal could not be read." },
  answerKey: "userResponse",
};

const FINAL_LIST_SCREEN = {
  layout: "card",
  title: "Review final list",
  sections: [
    { type: "field", key: "listName", label: "List name", placeholder: "Final list name" },
    {
      type: "rows",
      key: "candidateMembers",
      label: "Members",
      columns: [
        {
          title: "Name",
          keys: [
            "name",
            "fullName",
            "displayName",
            "companyName",
            "accountName",
            "contactName",
            "organizationName",
            "personName",
          ],
          fallback: "Member",
          numbered: true,
        },
      ],
      emptyText: "No members.",
      missingText: "The members could not be read.",
    },
    {
      type: "rows",
      key: "failures",
      label: "Failures",
      tone: "danger",
      columns: [
        { title: "Row", keys: ["rowIndex"] },
        { title: "Stage", keys: ["stage"] },
        { title: "Error", keys: ["error"] },
        { title: "Account", keys: ["accountId"] },
      ],
    },
  ],
  decisionsLabel: "Decision",
  decisions: [
    {
      label: "Approve list",
      answer: { decision: "approve", approved: true },
      sends: ["listName"],
      requires: ["candidateMembers"],
    },
    { label: "Cancel", answer: { decision: "reject", approved: false }, sends: [] },
  ],
  answerKey: "userResponse",
};

const REVIEWS = [
  {
    id: "@cinatra-ai/list-curator-agent:scrape-schema-review",
    kind: "scrape-schema-review",
    gate: "schema_gate",
    parse: "schema_decision_parse",
    screen: SCRAPE_SCHEMA_SCREEN,
    named: ["instructions", "outputSchema", "plan", "seedUrls"],
  },
  {
    id: "@cinatra-ai/list-curator-agent:final-list-review",
    kind: "final-list-review",
    gate: "list_gate",
    parse: "list_decision_parse",
    screen: FINAL_LIST_SCREEN,
    named: ["candidateMembers", "failures", "listName"],
  },
];

const bindingOf = (id) => {
  const found = (manifest.cinatra?.fieldRenderers ?? []).filter((b) => b && b.id === id);
  expect(found, `exactly one binding carries ${id}`).toHaveLength(1);
  return found[0];
};
/** The screen a binding declares: what the package ships, never the copy of it in this file. */
const declared = (id) => {
  const screen = bindingOf(id).screen;
  expect(screen, `${id} declares a screen`).toBeTruthy();
  return screen;
};
const propertiesOf = (gate) => refs[gate].metadata.cinatra.inputMessageSchema.properties;
const inputsOf = (gate) => refs[gate].inputs.map((i) => i.title);
const editableKeys = (screen) => screen.sections.filter((s) => EDITABLE.includes(s.type)).map((s) => s.key);
const namedKeys = (screen) =>
  [
    ...screen.sections.map((s) => s.key),
    ...screen.decisions.flatMap((d) => [...(d.sends ?? []), ...(d.requires ?? [])]),
    ...(screen.unreadable?.keys ?? []),
  ].filter((key, i, all) => all.indexOf(key) === i);

describe("the two review bindings declare their screens", () => {
  it("keeps exactly two bindings, and the gates name them", () => {
    const bindings = manifest.cinatra?.fieldRenderers ?? [];
    expect(bindings.map((b) => b.id)).toEqual(REVIEWS.map((r) => r.id));
    for (const review of REVIEWS) {
      const cinatra = refs[review.gate].metadata.cinatra;
      expect(cinatra.renderer).toBe(review.id);
      expect(cinatra.inputMessageSchema["x-renderer"]).toBe(review.id);
    }
  });

  for (const review of REVIEWS) {
    it(`${review.kind} declares exactly its screen and no component`, () => {
      const binding = bindingOf(review.id);
      expect(Object.keys(binding).sort()).toEqual(["id", "kind", "priority", "screen"]);
      expect(binding.kind).toBe(review.kind);
      expect(binding.priority).toBe(90);
      expect(binding.component).toBeUndefined();
      expect(binding.screen).toEqual(review.screen);
    });

    if (review.kind === "scrape-schema-review") {
      it("the Remove of a seed URL shows Remove and is named Remove URL with its number for assistive technology", () => {
        const section = declared(review.id).sections.find((s) => s.key === "seedUrls");
        expect(section.type).toBe("textList");
        expect(section.removeLabel).toBe("Remove");
        expect(section.removeAriaLabel).toBe("Remove URL");
      });
    }

    it(`${review.kind} screen is plain JSON within the product's size bound`, () => {
      const serialized = JSON.stringify(declared(review.id));
      expect(Buffer.byteLength(serialized, "utf8") <= MAX_SCREEN_BYTES, "8192 bytes or less").toBe(true);
      expect(JSON.stringify(JSON.parse(serialized))).toBe(serialized);
    });
  }
});

describe("every key a screen names is the gate's", () => {
  for (const review of REVIEWS) {
    const { gate } = review;

    it(`${review.kind}: every section, sends, requires and unreadable key is a property or input of ${gate}`, () => {
      const screen = declared(review.id);
      const named = namedKeys(screen);
      expect([...named].sort()).toEqual(review.named);
      const known = new Set([...Object.keys(propertiesOf(gate)), ...inputsOf(gate)]);
      for (const key of named) expect(known.has(key), `${key} is a property or input of ${gate}`).toBe(true);
    });

    it(`${review.kind}: a section the person edits is not read-only at the gate, and a section that only shows is`, () => {
      const screen = declared(review.id);
      const properties = propertiesOf(gate);
      for (const section of screen.sections) {
        const readOnly = properties[section.key]?.readOnly;
        if (EDITABLE.includes(section.type)) expect(readOnly, `${section.key} is editable`).toBeUndefined();
        else expect(readOnly, `${section.key} only shows`).toBe(true);
      }
      for (const key of screen.unreadable?.keys ?? []) {
        if (!editableKeys(screen).includes(key)) expect(properties[key].readOnly, `${key} is the proposal`).toBe(true);
      }
    });

    it(`${review.kind}: each answer's decision is in the gate's decision enum and approved agrees with it`, () => {
      const screen = declared(review.id);
      const allowed = propertiesOf(gate).decision.enum;
      expect(allowed).toEqual(["approve", "revise", "reject"]);
      expect(screen.decisions.map((d) => d.answer.decision)).toEqual(["approve", "reject"]);
      for (const { answer } of screen.decisions) {
        expect(allowed.includes(answer.decision), `${answer.decision} is in the enum`).toBe(true);
        expect(Object.keys(answer)).toEqual(["decision", "approved"]);
        expect(answer.approved).toBe(answer.decision === "approve");
      }
    });

    it(`${review.kind}: the answer key is the gate's one output and no section or answer key`, () => {
      const screen = declared(review.id);
      expect(refs[gate].outputs.map((o) => o.title)).toEqual([screen.answerKey]);
      expect(screen.answerKey).toBe("userResponse");
      const others = [...namedKeys(screen), ...screen.decisions.flatMap((d) => Object.keys(d.answer))];
      expect(others.includes(screen.answerKey)).toBe(false);
    });

    it(`${review.kind}: the answers that send values send every editable section, and a reject sends none`, () => {
      const screen = declared(review.id);
      const editable = editableKeys(screen);
      const [approve, reject] = screen.decisions;
      expect(approve.sends).toEqual(editable);
      expect(reject.sends).toEqual([]);
      for (const decision of screen.decisions) {
        expect(Array.isArray(decision.sends), "every answer declares sends").toBe(true);
        for (const key of decision.sends) expect(editable.includes(key), `${key} is an editable section`).toBe(true);
        for (const key of decision.requires ?? []) expect(screen.sections.some((s) => s.key === key)).toBe(true);
      }
      expect(reject.requires).toBeUndefined();
    });
  }
});

/**
 * The staged answer of the card's one Continue, as the product stages it:
 * { ...carried, ...answer, ...{k: value(k) for k in sends}, [answerKey]: JSON text of the same object }.
 * A list section's value is its non-blank entries as typed; a JSON section's value is the parsed text.
 */
function stage(screen, choice, typed, carried = {}) {
  const decision = screen.decisions[choice];
  const staged = { ...carried, ...decision.answer };
  for (const key of decision.sends) {
    const section = screen.sections.find((s) => s.key === key);
    if (section.type === "textList") staged[key] = typed[key].filter((entry) => entry.trim() !== "");
    else if (section.type === "json") staged[key] = JSON.parse(typed[key]);
    else staged[key] = typed[key];
  }
  return { ...staged, [screen.answerKey]: JSON.stringify(staged) };
}

const SCRAPE_TYPED = {
  instructions: "Read the team page only.",
  outputSchema: '{"type":"object","properties":{"name":{"type":"string"}}}',
  seedUrls: ["https://example.test/edited-1", "   ", "https://example.test/edited-2", ""],
};
const SCRAPE_EDITED = {
  seedUrls: ["https://example.test/edited-1", "https://example.test/edited-2"],
  outputSchema: { type: "object", properties: { name: { type: "string" } } },
  instructions: "Read the team page only.",
};
const SCRAPE_SHOWN_TYPED = { instructions: "", outputSchema: '{"type":"object"}', seedUrls: ["https://example.test/a"] };
const LIST_TYPED = { listName: "Renamed" };
const LIST_SHOWN_TYPED = { listName: "CTOs" };

const approveScrape = (typed) => stage(declared(REVIEWS[0].id), 0, typed);
const rejectScrape = (typed) => stage(declared(REVIEWS[0].id), 1, typed);
const approveList = (typed) => stage(declared(REVIEWS[1].id), 0, typed);
const cancelList = (typed) => stage(declared(REVIEWS[1].id), 1, typed);

/** The scenarios of the fixture, each with the answers that the declared screens stage. */
const declaredScenarios = () => ({
  "declared screens: both staged Approves reach collect and create with their edits": {
    answers: [approveScrape(SCRAPE_TYPED).userResponse, approveList(LIST_TYPED).userResponse],
    runs: ["propose", "collect", "create"],
    ends: "curation_summary",
    receives: [
      { step: "collect", call: 0, inputs: SCRAPE_EDITED },
      { step: "create", call: 0, inputs: { listName: "Renamed" } },
    ],
  },
  "declared screens: both staged Approves with the values shown run with them": {
    answers: [approveScrape(SCRAPE_SHOWN_TYPED).userResponse, approveList(LIST_SHOWN_TYPED).userResponse],
    runs: ["propose", "collect", "create"],
    ends: "curation_summary",
    receives: [
      { step: "collect", call: 0, inputs: { seedUrls: ["https://example.test/a"], outputSchema: { type: "object" }, instructions: "" } },
      { step: "create", call: 0, inputs: { listName: "CTOs" } },
    ],
  },
  "declared screens: the staged Reject at the scrape-plan review collects nothing": {
    answers: [rejectScrape(SCRAPE_TYPED).userResponse],
    runs: ["propose"],
    ends: "schema_declined",
  },
  "declared screens: the staged Cancel at the list review creates nothing": {
    answers: [approveScrape(SCRAPE_TYPED).userResponse, cancelList(LIST_TYPED).userResponse],
    runs: ["propose", "collect"],
    ends: "list_declined",
    receives: [{ step: "collect", call: 0, inputs: SCRAPE_EDITED }],
  },
});
const DECLARED_NAMES = [
  "declared screens: both staged Approves reach collect and create with their edits",
  "declared screens: both staged Approves with the values shown run with them",
  "declared screens: the staged Reject at the scrape-plan review collects nothing",
  "declared screens: the staged Cancel at the list review creates nothing",
];

describe("the answer a declared screen stages is read by the flow's decision steps", () => {
  it("stages an Approve with every typed value, blank entries dropped, and the same object as JSON text", () => {
    const staged = approveScrape(SCRAPE_TYPED);
    expect(Object.keys(staged)).toEqual(["decision", "approved", "instructions", "outputSchema", "seedUrls", "userResponse"]);
    const { userResponse, ...rest } = staged;
    expect(rest).toEqual({ decision: "approve", approved: true, ...SCRAPE_EDITED });
    expect(JSON.parse(userResponse)).toEqual(rest);
    expect(Object.keys(JSON.parse(userResponse))).toEqual(Object.keys(rest));
    const list = approveList(LIST_TYPED);
    expect(JSON.parse(list.userResponse)).toEqual({ decision: "approve", approved: true, listName: "Renamed" });
  });

  it("stages a Reject with no value that was typed", () => {
    for (const staged of [rejectScrape(SCRAPE_TYPED), cancelList(LIST_TYPED)]) {
      expect(Object.keys(staged)).toEqual(["decision", "approved", "userResponse"]);
      expect(JSON.parse(staged.userResponse)).toEqual({ decision: "reject", approved: false });
    }
  });

  it("reaches each decision step through the gate's answer key, its wrap step and its parse step", () => {
    const edges = oas.data_flow_connections.map(
      (e) => `${e.source_node.$component_ref}.${e.source_output} -> ${e.destination_node.$component_ref}.${e.destination_input}`,
    );
    for (const review of REVIEWS) {
      const wrap = review.gate.replace("_gate", "_answer_wrap");
      expect(edges).toContain(`${review.gate}.${review.screen.answerKey} -> ${wrap}.answer`);
      expect(edges).toContain(`${wrap}.output -> ${review.parse}.text`);
      expect(refs[review.parse].component_type).toBe("PluginExtractNode");
      expect(refs[wrap].template).toContain('{"answer": {{ answer | tojson');
    }
  });

  for (const name of DECLARED_NAMES) {
    it(`the fixture runs "${name}" with the answers the screens stage`, () => {
      const expected = declaredScenarios()[name];
      const scenario = scenarios.find((s) => s.name === name);
      expect(scenario, `tests/fixtures/gate-answer-scenarios.json has the scenario ${name}`).toBeTruthy();
      expect(scenario.answers).toEqual(expected.answers);
      expect(scenario.runs).toEqual(expected.runs);
      expect(scenario.ends).toBe(expected.ends);
      expect(scenario.receives).toEqual(expected.receives);
    });
  }

  it("holds each declared-screens scenario once, and no other", () => {
    const names = scenarios.map((s) => s.name).filter((n) => n.startsWith("declared screens:"));
    expect(names).toEqual(DECLARED_NAMES);
  });
});

/** Every file below a directory, as package-relative paths. */
function walk(dir) {
  const full = path.join(packageRoot, dir);
  if (!existsSync(full)) return [];
  const out = [];
  for (const entry of readdirSync(full)) {
    const rel = path.join(dir, entry);
    if (statSync(path.join(packageRoot, rel)).isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

const DRAWING_PACKAGES = new Set([
  "react",
  "react-dom",
  "lucide-react",
  "jsdom",
  "@types/react",
  "@types/react-dom",
  "@cinatra-ai/sdk-ui",
  "@cinatra-ai/design-primitives",
]);
const isDrawingPackage = (name) => DRAWING_PACKAGES.has(name) || name.startsWith("@testing-library/");
const importsOf = (text) => {
  const found = [];
  for (const match of text.matchAll(/^\s*(?:import|export)\b[^"';]*?\bfrom\s+["']([^"']+)["']|^\s*import\s+["']([^"']+)["']/gm)) {
    found.push(match[1] ?? match[2]);
  }
  return found;
};
const baseOf = (specifier) => specifier.split("/").slice(0, specifier.startsWith("@") ? 2 : 1).join("/");

describe("the package ships nothing that draws", () => {
  it("has no renderer module, no test of one, no double of a primitive and no declaration of one", () => {
    for (const gone of [
      "src/list-curator-scrape-schema-renderer.tsx",
      "src/list-curator-final-list-renderer.tsx",
      "src/__tests__/list-curator-scrape-schema-renderer.test.tsx",
      "src/__tests__/list-curator-final-list-renderer.test.tsx",
      "tests/doubles/design-primitives.tsx",
      "src/__tests__/fixtures/design-primitives.d.ts",
    ]) {
      expect(existsSync(path.join(packageRoot, gone)), `${gone} is gone`).toBe(false);
    }
  });

  it("has no component file, and no source or test file imports a drawing package", () => {
    const files = [...walk("src"), ...walk("tests")];
    expect(files.filter((f) => /\.(tsx|jsx)$/.test(f))).toEqual([]);
    const offenders = [];
    for (const file of files.filter((f) => /\.(ts|mts|mjs|js)$/.test(f))) {
      for (const specifier of importsOf(readFileSync(path.join(packageRoot, file), "utf8"))) {
        if (isDrawingPackage(baseOf(specifier))) offenders.push(`${file} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("declares no React, icon or UI package, as a dependency, a peer or a test dependency", () => {
    const fields = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "peerDependenciesMeta"];
    const declared = [];
    for (const field of fields) {
      for (const name of Object.keys(manifest[field] ?? {})) if (isDrawingPackage(name)) declared.push(`${field}: ${name}`);
    }
    expect(declared).toEqual([]);
  });

  it("names a version that asks for a host that draws declared screens", () => {
    const [major, minor] = manifest.version.split(".").map(Number);
    expect(major === 0 && minor >= 4, `${manifest.version} is 0.4.0 or later`).toBe(true);
  });
});
