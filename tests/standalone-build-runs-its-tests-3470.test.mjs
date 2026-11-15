/**
 * A STANDALONE BUILD CAN RUN THE PACKAGE'S TESTS (cinatra-ai/cinatra#3470).
 *
 * This repository's build job (.github/workflows/ci.yml) first classifies the
 * package. A package that declares a first-party @cinatra-ai/* peer is a source
 * mirror, and the job skips install, typecheck and test for it: the host
 * monorepo runs them. A package that declares none is standalone, and the job
 * installs (without a frozen lockfile), typechecks and runs `pnpm test
 * --if-present`.
 *
 * Until the review screens were declared, the optional @cinatra-ai/sdk-ui peer
 * (used only by the two renderers) made this package a source mirror. With the
 * renderers gone and the peer dropped, the package is standalone. Its test
 * script is `vitest run`, so a standalone build can run it only if the package
 * declares vitest itself.
 *
 * These arms run the job's own classifier, read out of ci.yml, over this
 * package's package.json, so they follow the job instead of a copy of it:
 * - the classifier is found in ci.yml and reads the package as standalone or as
 *   a source mirror, never as a dependency-shape error;
 * - when the package is standalone and its test script runs vitest,
 *   devDependencies declares vitest as a caret range of a full version, the
 *   form the sibling packages use;
 * - the install step does not freeze a lockfile, and the repository ignores
 *   the lockfile a standalone install writes, so a devDependency needs no
 *   lockfile change;
 * - the build job runs the package's test script.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
const ci = readFileSync(path.join(packageRoot, ".github", "workflows", "ci.yml"), "utf8");
const gitignore = readFileSync(path.join(packageRoot, ".gitignore"), "utf8");

/** The program of the "Classify repo" step: the text between `node -e '` and its closing quote. */
function classifierSource() {
  const step = ci.slice(ci.indexOf("- name: Classify repo"));
  const found = step.match(/node -e '\n([\s\S]*?)\n\s*' \|\| code=\$\?/);
  expect(found, "ci.yml has the Classify repo step with its node -e program").toBeTruthy();
  return found[1];
}

/** The exit code the job's classifier gives for this package: 0 source mirror, 1 standalone, 2 shape error. */
function classify() {
  try {
    execFileSync(process.execPath, ["-e", classifierSource()], { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"] });
    return 0;
  } catch (error) {
    if (typeof error.status === "number") return error.status;
    throw error;
  }
}

describe("a standalone build can run the package's tests", () => {
  it("reads the build job's own classifier from ci.yml", () => {
    const source = classifierSource();
    expect(source).toContain('require("./package.json")');
    expect(source).toContain("process.exit(peers.length ? 0 : 1)");
  });

  it("classifies the package as standalone or as a source mirror, never as a shape error", () => {
    expect([0, 1]).toContain(classify());
  });

  it("declares vitest as a caret range of a full version when it is standalone and its tests run vitest", () => {
    const standalone = classify() === 1;
    const runsVitest = /\bvitest\b/.test(manifest.scripts?.test ?? "");
    if (!standalone || !runsVitest) return;
    const declared = manifest.devDependencies?.vitest;
    expect(typeof declared, "a standalone build that runs `vitest run` declares vitest in devDependencies").toBe("string");
    expect(declared).toMatch(/^\^\d+\.\d+\.\d+$/);
  });

  it("installs without a frozen lockfile, and the repository ignores the lockfile that install writes", () => {
    const lines = ci.split("\n").filter((line) => !line.trim().startsWith("#"));
    expect(lines.some((line) => line.includes("pnpm install --no-frozen-lockfile"))).toBe(true);
    expect(lines.some((line) => /(?<!no-)--frozen-lockfile/.test(line))).toBe(false);
    expect(gitignore.split("\n").map((line) => line.trim())).toContain("pnpm-lock.yaml");
  });

  it("runs the package's test script in the build job", () => {
    expect(ci).toContain("pnpm test --if-present");
    expect(typeof manifest.scripts?.test, "the package has a test script for the job to run").toBe("string");
  });
});
