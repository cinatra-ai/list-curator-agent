import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Package-local test config.
//
// WITHOUT IT this package ships no vitest config of its own, so a `vitest run`
// from here inside the cinatra monorepo layout (extensions/cinatra-ai/<slug>/)
// walks UP and loads the HOST ROOT vitest.config.ts, whose `include` is written
// for the host tree: it matches the three suites under src/__tests__/ and
// NOTHING under tests/. The two W8 suites added by pull requests 45 and 46 —
// tests/lifecycle-d-w8-drawn-inputs.test.mjs and tests/lifecycle-d-w8-flow.test.mjs
// — were therefore executed by no vitest run at all; they passed only under
// node's own runner.
//
// The consequence is silent, not loud: the run exits 0 and reports "3 passed",
// so every count-based look at it says healthy while two on-disk files are
// collected by nothing — the cinatra#2288 defect itself, caught here by the
// host's extension suite discovery gate, which compares the files vitest
// actually EXECUTED against the ones on disk instead of trusting a green exit.
//
// `environment: "node"` is correct and not a downgrade: the two renderer
// suites carry their own `// @vitest-environment jsdom` pragma, and the W6/W8
// suites are pure JSON reading over the shipped manifest — no DOM is touched.
// The JSX transform comes from this package's own tsconfig ("jsx": "react-jsx").
// `@cinatra-ai/design-primitives` is the HOST-SHARED design primitives module
// (slice 3 of cinatra-ai/cinatra#3471). Its id is VIRTUAL: the contract
// publishes no package under it and forbids declaring it as a dependency or a
// peer, and the host resolves it for this package's two source-COMPILED field
// renderers through its own `compilerOptions.paths` entry onto
// `src/lib/artifacts/host-shared-primitives.ts` (the contract's BUILD-TIME
// road). Standalone nothing resolves it, so the two renderer suites could not
// load their subject at all; the id is aliased to a test-only double that lives
// OUTSIDE src/ (tests/doubles/), so it is never package source and never a
// tsconfig input (this package's tsconfig includes src/** only).
//
// The alias matches the EXACT bare id and nothing else: a near-miss subpath of
// it (the bare id with a component name appended) is refused by the host's path
// map and by the SDK's externals allowlist alike, and must not be quietly
// resolved here either. It applies ONLY while the specifier does not resolve,
// and the probe is NODE resolution: the id is resolved by a tsconfig `paths`
// entry, not by node, so the probe fails inside the monorepo too and the two
// renderer suites run against the DOUBLE there as well as standalone. That is
// intended — they are isolated renderer tests, and a green run of them is
// never evidence that the host's real primitives render the same way. Should a
// real package ever become node-resolvable under this id, the alias drops out
// on its own and the double goes inert.
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function resolvableOrDouble(specifier: string, doubleFile: string) {
  try {
    require.resolve(specifier);
    return [];
  } catch {
    return [
      {
        find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`),
        replacement: path.join(here, "tests", "doubles", doubleFile),
      },
    ];
  }
}

export default defineConfig({
  resolve: {
    alias: [...resolvableOrDouble("@cinatra-ai/design-primitives", "design-primitives.tsx")],
  },
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.{ts,tsx}", "tests/**/*.test.mjs"],
    exclude: ["**/node_modules/**"],
  },
});
