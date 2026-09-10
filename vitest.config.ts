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
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.{ts,tsx}", "tests/**/*.test.mjs"],
    exclude: ["**/node_modules/**"],
  },
});
