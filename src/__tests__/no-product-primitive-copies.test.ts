// The migration onto the HOST-SHARED design primitives
// (cinatra-ai/cinatra#3471 slice 3, epic #2926:
// a self-rendering extension takes the product's design primitives FROM THE
// HOST and carries no byte copy of them).
//
// The contract (docs/internals/contracts/host-shared-primitives-contract.md,
// "How a package migrates — the three lines a package changes") is what this
// file pins, for this package's SEVEN frozen-list copies — badge, button, card,
// input, input-group, label and textarea:
//
//   1. package.json — do not declare `@cinatra-ai/design-primitives` as a
//      dependency or a peer. The id is VIRTUAL; any specifier (an optional peer
//      included) makes the install 404.
//   2. the imports — every `from "./components/ui/<item>"` becomes
//      `from "@cinatra-ai/design-primitives"`.
//   3. the copies — delete `src/components/ui/<item>.tsx` for every primitive
//      in the frozen list.
//
// This package's two field renderers are source-COMPILED by the host (the
// BUILD-TIME road of the contract's "Two roads" section: the host's own
// tsconfig maps `@cinatra-ai/list-curator-agent/src/list-curator-*-renderer`
// onto the files in its extensions tree and `@cinatra-ai/design-primitives`
// onto `src/lib/artifacts/host-shared-primitives.ts`), so the import line is
// the whole package-side change: there is no client renderer bundle here and
// therefore no preamble field and no contract-version field to declare.
//
// A regression here is silent in this repo's own CI — a standalone extension
// mirror classifies first_party=1 and skips install, typecheck and test — which
// is exactly why the copy and the copy-shaped import are pinned as SOURCE facts
// rather than left to a type error in the monorepo.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PACKAGE_NAME = "@cinatra-ai/list-curator-agent";

/**
 * This package's root: the package.json that names it, found by walking UP from
 * THIS FILE's own directory — never from the working directory, which says only
 * where vitest happened to be invoked. Inside the monorepo a run started at the
 * host root would walk up from there, meet the HOST's package.json first and
 * never reach this package at all, so the suite would throw during collection
 * instead of proving anything. `process.cwd()` stays as the fallback for an
 * environment where `import.meta.url` is not a file URL (the jsdom environment
 * the renderer suites declare; this suite declares none). The manifest's own
 * name is what ends the walk either way.
 */
function packageRoot(): string {
  let dir = process.cwd();
  try {
    if (import.meta.url.startsWith("file:")) dir = path.dirname(fileURLToPath(import.meta.url));
  } catch {
    // keep the working directory as the start of the walk
  }
  const start = dir;
  for (;;) {
    const manifest = path.join(dir, "package.json");
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string };
      if (parsed.name === PACKAGE_NAME) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`${PACKAGE_NAME} root not found above ${start}`);
    dir = parent;
  }
}

const REPO_ROOT = packageRoot();
const SRC = path.join(REPO_ROOT, "src");

/** The host-neutral module id the contract fixes (`HOST_DESIGN_PRIMITIVES_MODULE`). */
const SHARED_MODULE = "@cinatra-ai/design-primitives";

/** Where the ambient declaration of the virtual id is allowed to live. */
const DECLARATION = "src/__tests__/fixtures/design-primitives.d.ts";

/** Every `.ts`/`.tsx` file under src/, optionally excluding this package's tests. */
function walk(dir: string, skipTests: boolean): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (skipTests && entry === "__tests__") continue;
      out.push(...walk(full, skipTests));
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const relative = (file: string) => path.relative(REPO_ROOT, file);

/** The names one bare-id import statement of a renderer brings in. */
function sharedImportNames(renderer: string): string[] {
  const text = readFileSync(path.join(REPO_ROOT, renderer), "utf8");
  const statements = [
    ...text.matchAll(/import\s+\{([^}]*)\}\s+from\s+["']@cinatra-ai\/design-primitives["']/g),
  ];
  expect(statements).toHaveLength(1);
  return statements[0][1]
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

describe("host-shared design primitives (cinatra#3471 slice 3)", () => {
  it("keeps no byte copy of a product primitive under src/components/ui/", () => {
    const uiDir = path.join(SRC, "components", "ui");
    const remaining = existsSync(uiDir) ? readdirSync(uiDir) : [];
    expect(remaining).toEqual([]);
    expect(existsSync(uiDir)).toBe(false);
  });

  it("keeps no vendored cn helper the deleted copies were the only importers of", () => {
    expect(existsSync(path.join(SRC, "lib", "utils.ts"))).toBe(false);
  });

  it("imports no product-primitive copy from any source file", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC, true)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/from\s+["'](\.[^"']*)["']/g)) {
        if (/(^|\/)(components\/)?ui\//.test(match[1])) {
          offenders.push(`${relative(file)} -> ${match[1]}`);
        }
      }
      for (const match of text.matchAll(/from\s+["'](@\/[^"']*)["']/g)) {
        if (/^@\/(components\/ui\/|lib\/utils)/.test(match[1])) {
          offenders.push(`${relative(file)} -> ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses the module id only as the EXACT bare specifier, never a subpath", () => {
    // The host's path map and the SDK's externals allowlist both refuse a
    // near-miss such as `@cinatra-ai/design-primitives/button`, with the same
    // exact-tuple discipline React has.
    const offenders: string[] = [];
    for (const file of walk(SRC, false)) {
      for (const match of readFileSync(file, "utf8").matchAll(
        /["'](@cinatra-ai\/design-primitives[^"']*)["']/g,
      )) {
        if (match[1] !== SHARED_MODULE) offenders.push(`${relative(file)} -> ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("takes the scrape-schema renderer's primitives from the host-shared module", () => {
    expect(sharedImportNames("src/list-curator-scrape-schema-renderer.tsx")).toEqual([
      "Badge",
      "Button",
      "Card",
      "CardContent",
      "CardFooter",
      "CardHeader",
      "CardTitle",
      "InputGroup",
      "InputGroupAddon",
      "InputGroupInput",
      "Label",
      "Textarea",
    ]);
  });

  it("takes the final-list renderer's primitives from the host-shared module", () => {
    expect(sharedImportNames("src/list-curator-final-list-renderer.tsx")).toEqual([
      "Badge",
      "Button",
      "Card",
      "CardContent",
      "CardFooter",
      "CardHeader",
      "CardTitle",
      "Input",
      "Label",
    ]);
  });

  it("declares the virtual module id neither as a dependency nor as a peer", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    ) as Record<string, Record<string, unknown> | undefined>;
    const declared = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
      "peerDependenciesMeta",
    ].filter((field) =>
      Object.keys(manifest[field] ?? {}).some((key) => key.includes("design-primitives")),
    );
    expect(declared).toEqual([]);
  });

  it("declares the virtual id at the one path the host's tsconfig excludes, and nowhere else", () => {
    // An ambient `declare module` beats a tsconfig `paths` mapping for every
    // file of the program that reads it, so inside the host it must never be
    // part of the program: the host maps the same id onto its REAL module and
    // serves the whole frozen export list, while this package declares only the
    // thirteen names its renderers use — the host build would fail TS2305 on
    // every other name. cinatra main's tsconfig includes `**/*.ts` and excludes
    // `**/__tests__/fixtures/**`, and this extension tree is materialised at
    // `extensions/cinatra-ai/list-curator-agent/`, so the declaration is safe
    // under `src/__tests__/fixtures/` and nowhere else under src/. This pins the
    // placement instead of leaving it to a file comment.
    const declaring = walk(SRC, false)
      .filter((file) => readFileSync(file, "utf8").includes(`declare module "${SHARED_MODULE}"`))
      .map(relative);
    expect(declaring).toEqual([DECLARATION]);
  });
});
