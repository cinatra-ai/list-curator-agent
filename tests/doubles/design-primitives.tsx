// TEST-ONLY local double of the HOST-SHARED design primitives module
// (`@cinatra-ai/design-primitives`, slice 3 of cinatra-ai/cinatra#3471).
//
// The module id is VIRTUAL: the contract
// (docs/internals/contracts/host-shared-primitives-contract.md) fixes it as
// host-neutral and says no package is published under it — "the id is VIRTUAL:
// the host serves it at run time and no package is published under it, so *any*
// specifier — optional peer included — makes the install fail". The host
// resolves it for this package's two source-COMPILED field renderers through
// its own `compilerOptions.paths` entry onto
// `src/lib/artifacts/host-shared-primitives.ts` (the contract's BUILD-TIME
// road). NODE resolution of the id fails everywhere — standalone AND inside
// the monorepo, because a tsconfig `paths` entry is not a node resolution — so
// `vitest run` aliases the EXACT bare id here (vitest.config.ts) in both
// places, and the two renderer suites render THIS file, never the host's real
// primitives. That is what those suites are for; conformance with the real
// primitives is the host's own concern. The alias applies only while the
// specifier does not resolve, so a node-resolvable module under this id would
// win and leave this file inert.
//
// DELIBERATELY NOT A COPY of the product primitives. It carries no variant
// table, no class strings and no `cn` call — copying those back would
// reintroduce, under another name, exactly the byte copies this migration
// removes. It implements ONLY the thirteen frozen-list names the two renderers
// use, each as the bare element the renderers' own DOM tests reach for
// (`getByRole("button")`, `getByLabelText`, `getByDisplayValue`), with the
// `data-slot` hooks and `variant` swallowed rather than spread onto the DOM.
//
// It lives OUTSIDE src/ so it can never be mistaken for package source, is
// never a tsconfig input (this package's tsconfig includes src/** only), and is
// outside the published `files` set.

import * as React from "react";

type WithVariant<T> = T & { variant?: string };
type WithVariantAndSize<T> = T & { variant?: string; size?: string };

export function Badge({ variant: _variant, ...props }: WithVariant<React.ComponentProps<"span">>) {
  return <span data-slot="badge" {...props} />;
}

export function Button({
  variant: _variant,
  size: _size,
  ...props
}: WithVariantAndSize<React.ComponentProps<"button">>) {
  return <button data-slot="button" type="button" {...props} />;
}

export function Card(props: React.ComponentProps<"div">) {
  return <div data-slot="card" {...props} />;
}

export function CardContent(props: React.ComponentProps<"div">) {
  return <div data-slot="card-content" {...props} />;
}

export function CardFooter(props: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" {...props} />;
}

export function CardHeader(props: React.ComponentProps<"div">) {
  return <div data-slot="card-header" {...props} />;
}

export function CardTitle(props: React.ComponentProps<"div">) {
  return <div data-slot="card-title" {...props} />;
}

export function Input(props: React.ComponentProps<"input">) {
  return <input data-slot="input" {...props} />;
}

export function InputGroup(props: React.ComponentProps<"div">) {
  return <div data-slot="input-group" {...props} />;
}

export function InputGroupAddon(props: React.ComponentProps<"div">) {
  return <div data-slot="input-group-addon" {...props} />;
}

export function InputGroupInput(props: React.ComponentProps<"input">) {
  return <input data-slot="input-group-input" {...props} />;
}

export function Label(props: React.ComponentProps<"label">) {
  return <label data-slot="label" {...props} />;
}

export function Textarea(props: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" {...props} />;
}
