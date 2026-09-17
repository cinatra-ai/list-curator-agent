// Resolution shim for this package's OWN standalone `tsc --noEmit`, for the
// test-only module ids its suites import.
//
// WHY THIS FILE EXISTS. The package declares no devDependencies and carries no
// lockfile: `vitest` and the `node:*` builtins have no declarations anywhere in
// the tree, and `process` has no global declaration, so the package's own tsc
// program reports TS2307 on those ids and TS2580 on that global. The real
// `vitest` and `@types/node` declarations come from the monorepo run, which is
// where these suites actually EXECUTE; the standalone compiler only needs the
// ids to resolve. So this is a RESOLUTION SHIM, never a type contract — every
// member below is declared with the loosest shape that keeps the call sites
// meaningful.
//
// WHY THE SHAPES ARE LOOSE ON PURPOSE. An ambient declaration is global: it
// resolves these ids for EVERY file of the program, including the suites whose
// bodies the compiler has never checked until now (their imports did not
// resolve, so every imported name was `any`). A tight shape would turn those
// newly checked bodies into errors of their own. The matcher object therefore
// carries an index signature, so no matcher can be missing, and the mock
// factory returns `any`, so a mock's `.mock.calls` stays reachable.
//
// WHY IT LIVES UNDER `src/__tests__/fixtures/` AND NOWHERE ELSE. This is the
// placement its sibling `design-primitives.d.ts` fixes, for the same reason: an
// ambient declaration must never become part of the HOST's program, where
// `vitest` and the `node:*` ids resolve to their real, complete declarations
// and this file would shadow them. The host's tsconfig excludes
// `**/__tests__/fixtures/**` while this package's own include (`src/**/*.ts`)
// reaches it, so the declaration is inside this package's program and outside
// the host's. It is also outside the published `files` set (`!src/__tests__`),
// so no consumer installing this package receives it.
//
// WHAT THIS FILE IS NOT.
//   * Not a dependency: a type-only ambient declaration adds no specifier to
//     package.json, and none of these ids is installed by this package.
//   * Not a `paths` entry and not an `allowJs` flip: either would change what
//     the program compiles, rather than only what its ids resolve to.
//   * Not a wildcard: only the four ids named below are declared. There is no
//     `declare module "*"` escape, so an id nobody imports stays unresolved.
//
// ONLY the surface this package's suites under `src/__tests__/` actually reach
// is declared. No suite here uses `.not`, `.resolves`, `.rejects`,
// `expect.any`, `beforeEach`, `beforeAll` or `afterAll`, and none of those is
// declared.
//
// This file is a global script (no top-level import or export) on purpose: a
// top-level import would make it a module, `declare module` would then be read
// as an augmentation of a module that does not resolve, and `process` would
// stop being global.

declare module "vitest" {
  type AnyFn = (...args: any[]) => any;

  /**
   * What `expect(...)` returns. The suites call `toBe`, `toBeDefined`,
   * `toBeUndefined`, `toEqual`, `toHaveLength`, `toMatchObject` and
   * `toHaveBeenCalledTimes`; the index signature keeps any other matcher
   * reachable rather than making the shim a list that can fall behind.
   */
  interface Assertion {
    toBe(expected?: any): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toEqual(expected?: any): void;
    toHaveLength(expected?: any): void;
    toMatchObject(expected?: any): void;
    toHaveBeenCalledTimes(expected?: any): void;
    [matcher: string]: any;
  }

  export function describe(name: string, suite: AnyFn): void;
  export function it(name: string, test: AnyFn): void;
  export function afterEach(hook: AnyFn): void;
  export function expect(actual?: any): Assertion;

  /** Only `fn` and `restoreAllMocks` are reached by the suites here. */
  export const vi: {
    fn(implementation?: AnyFn): any;
    restoreAllMocks(): void;
  };
}

declare module "node:fs" {
  export function existsSync(target: any): boolean;
  export function readdirSync(dir: any): string[];
  export function readFileSync(file: any, encoding?: any): string;
  export function statSync(target: any): { isDirectory(): boolean };
}

declare module "node:path" {
  // Declared as named exports, which is also what a namespace import
  // (`import * as path from "node:path"`) reads: the copies suite reaches
  // `dirname`, `join` and `relative` through it.
  export function dirname(p: string): string;
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: any): string;
}

/** The one global a suite here reads, through `process.cwd()`. */
declare var process: { cwd(): string };
