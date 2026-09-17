// Types for the HOST-SHARED design primitives module
// (`@cinatra-ai/design-primitives`, slice 3 of cinatra-ai/cinatra#3471).
//
// WHY THIS FILE EXISTS. The module id is VIRTUAL: the contract
// (docs/internals/contracts/host-shared-primitives-contract.md) publishes no
// package under it, and its own "What this slice does NOT do" section fixes the
// boundary this file lands on — "The typed contract names the exports, not
// their component types. The contract module is React-free by design (importing
// it must never pull a second copy of anything), so `HostDesignPrimitivesModule`
// is `unknown`-valued: a migrating package types the values against its own
// React types." So the package declares the shapes it consumes, here, for its
// OWN standalone `tsc` only.
//
// WHY IT LIVES UNDER `src/__tests__/fixtures/` AND NOWHERE ELSE. An ambient
// `declare module` wins over a tsconfig `paths` mapping for every file of the
// program that reads it. Inside the host this file must therefore never be part
// of the program, or it would shadow the host's REAL module
// (`src/lib/artifacts/host-shared-primitives.ts`, which serves the whole frozen
// export list) and the host build would fail TS2305 on every name this package
// does not declare. cinatra main's tsconfig includes `**/*.ts` and excludes
// `**/__tests__/fixtures/**`, and this extension tree is materialised at
// `extensions/cinatra-ai/list-curator-agent/`, so THIS path is inside this
// package's own include (`src/**/*.ts`) and outside the host's program. It is
// also outside the published `files` set (`!src/__tests__`), so no consumer
// installing this package receives the declaration at all.
// src/__tests__/no-product-primitive-copies.test.ts pins the placement so the
// file cannot drift into a directory the host DOES compile.
//
// WHAT THIS FILE IS NOT.
//   * Not a copy of a product primitive: it carries no implementation, no
//     variant table and no class strings — the seven byte copies this migration
//     deleted never come back under another name.
//   * Not a dependency on the virtual id: a type-only ambient declaration adds
//     no specifier to package.json, which the contract forbids ("any specifier —
//     optional peer included — makes the install fail").
//   * Not a tsconfig `paths` entry: pointing the id at a local file would turn
//     the contract's BUILD-TIME road into a local copy. Inside the host, the
//     host's own generated path map resolves the id and serves the real module.
//
// ONLY the thirteen frozen-list names this package's two renderers use are
// declared. The contract's rows carry more (`badgeVariants`, `buttonVariants`,
// `CardAction`, `CardDescription`, `InputGroupButton`, `InputGroupText`,
// `InputGroupTextarea`); this package imports none of them, and an export
// nobody uses is not declared here.
//
// This file is a global script (no top-level import/export) on purpose: a
// top-level import would make it a module, and `declare module` would then be
// read as an augmentation of a module that does not resolve. React types are
// reached through inline `import("react")` types instead.

declare module "@cinatra-ai/design-primitives" {
  type Props<T extends keyof import("react").JSX.IntrinsicElements> =
    import("react").ComponentProps<T>;
  type Rendered = import("react").ReactElement | null;

  /** The `badge` row. Both renderers pass `variant` ("outline"/"secondary"). */
  export const Badge: (props: Props<"span"> & { variant?: string }) => Rendered;

  /**
   * The `button` row. Both renderers pass `variant`, `onClick` and `disabled`;
   * the scrape-schema renderer also passes `size` ("sm") on its row buttons.
   */
  export const Button: (
    props: Props<"button"> & { variant?: string; size?: string },
  ) => Rendered;

  /** The `card` row, as far as this package uses it. */
  export const Card: (props: Props<"div">) => Rendered;
  export const CardContent: (props: Props<"div">) => Rendered;
  export const CardFooter: (props: Props<"div">) => Rendered;
  export const CardHeader: (props: Props<"div">) => Rendered;
  export const CardTitle: (props: Props<"div">) => Rendered;

  /** The `input` row. The final-list renderer binds it to the list name. */
  export const Input: (props: Props<"input">) => Rendered;

  /** The `input-group` row, as far as the scrape-schema renderer uses it. */
  export const InputGroup: (props: Props<"div">) => Rendered;
  export const InputGroupAddon: (props: Props<"div">) => Rendered;
  export const InputGroupInput: (props: Props<"input">) => Rendered;

  /** The `label` row. Both renderers pass `htmlFor`. */
  export const Label: (props: Props<"label">) => Rendered;

  /** The `textarea` row. The scrape-schema renderer binds two of them. */
  export const Textarea: (props: Props<"textarea">) => Rendered;
}
