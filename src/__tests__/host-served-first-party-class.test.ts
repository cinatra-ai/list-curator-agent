// This repo's vendored `extension-kind-gate.mjs` must classify the host-shared
// primitives module id as the HOST-SERVED first-party class, not as a non-SDK
// first-party coupling.
//
// The gate is a MIRROR of the cinatra monorepo's canonical
// `scripts/extensions/inventory.mjs`, whose class this file pins:
//
//   export const HOST_SERVED_PACKAGES = new Set([HOST_DESIGN_PRIMITIVES_MODULE]);
//   ...
//   if (HOST_SERVED_PACKAGES.has(base)) return false; // served by the host at run time
//
// Why the class exists: the host serves these modules to an extension — at run
// time to a loaded bundle (left EXTERNAL, like React, and resolved to the
// host's ONE instance) or at compile time to the parts it builds from source —
// so an extension importing one takes on NO extraction-blocking coupling:
// nothing is extracted with it, there is no package to carve out.
//
// Without the mirrored class the two renderers' `@cinatra-ai/design-primitives`
// import — the line the migration is — fails this repo's own `kind-gates` job,
// which runs `node extension-kind-gate.mjs --package-root .` and is a required
// context.
import { describe, expect, it } from "vitest";

import {
  HOST_SERVED_PACKAGES,
  SDK_PACKAGES,
  isSdkOnlyViolation,
} from "../../extension-kind-gate.mjs";

const SHARED_MODULE = "@cinatra-ai/design-primitives";

describe("extension-kind-gate host-served first-party class", () => {
  it("carries the host-shared primitives module id in its own class", () => {
    expect(HOST_SERVED_PACKAGES.has(SHARED_MODULE)).toBe(true);
    // The class is DISTINCT from the SDK class — the id is not an SDK package.
    expect(SDK_PACKAGES.has(SHARED_MODULE)).toBe(false);
  });

  it("does not report the host-served id as a non-SDK first-party dependency", () => {
    expect(isSdkOnlyViolation(SHARED_MODULE)).toBe(false);
    // A subpath collapses to the base package, exactly as in the SDK class.
    expect(isSdkOnlyViolation(`${SHARED_MODULE}/button`)).toBe(false);
  });

  it("still reports a first-party package the host does not serve", () => {
    expect(isSdkOnlyViolation("@cinatra-ai/objects")).toBe(true);
    expect(isSdkOnlyViolation("@cinatra-ai/mcp-server/credentials")).toBe(true);
  });
});
