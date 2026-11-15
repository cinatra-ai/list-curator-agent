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
// Until cinatra-ai/cinatra#3470 the package's two field renderers took their
// primitives from the host this way. They are gone: the two review screens are
// declared in package.json and the product draws them. What stays pinned is that
// the package carries no copy and no import of a product primitive.
//
// Pinned as SOURCE facts, rather than left to a type error in the monorepo.

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
 * environment where `import.meta.url` is not a file URL (a DOM test
 * environment, which this suite does not declare). The manifest's own
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

  it("declares the virtual id nowhere: the package ships no module that draws", () => {
    // Before cinatra-ai/cinatra#3470 the two field renderers imported the host's
    // primitives, and an ambient declaration of the virtual id lived at the one
    // path the host's tsconfig excludes. The package now declares its review
    // screens and the product draws them, so no source file imports the id and
    // no file declares it.
    const declaring = walk(SRC, false)
      .filter((file) => readFileSync(file, "utf8").includes(`declare module "${SHARED_MODULE}"`))
      .map(relative);
    expect(declaring).toEqual([]);
  });
});
