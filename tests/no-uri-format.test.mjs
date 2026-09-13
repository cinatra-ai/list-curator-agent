import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Issue #59: a run failed at its very first model call because the structured
// response schema handed to the model service carried the JSON Schema keyword
// `"format": "uri"` on the seedUrls string items. The service refuses that
// format value and answers with a 400 ("'uri' is not a valid format"), so the
// run dies before it produces anything. The manifest is the source of that
// schema, so the manifest must not declare the keyword anywhere — not only on
// the input declaration, but on every copy of the flow's node inputs and
// outputs the manifest carries.
const manifestPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "cinatra",
  "oas.json",
);
const rawManifest = readFileSync(manifestPath, "utf8");

/** Every path in `value` where a `format` keyword declares the value "uri". */
function uriFormatPaths(value, path = "$") {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => uriFormatPaths(entry, `${path}[${index}]`));
  }
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) =>
    key === "format" && entry === "uri"
      ? [`${path}.format`]
      : uriFormatPaths(entry, `${path}.${key}`),
  );
}

describe("cinatra/oas.json declares no uri format", () => {
  it("carries no format keyword set to uri in its parsed body", () => {
    expect(uriFormatPaths(JSON.parse(rawManifest))).toEqual([]);
  });

  it("carries no format keyword set to uri in its raw text", () => {
    const offendingLines = rawManifest
      .split("\n")
      .map((line, index) => ({ line: index + 1, text: line.trim() }))
      .filter(({ text }) => /"format"\s*:\s*"uri"/.test(text));

    expect(offendingLines).toEqual([]);
  });
});
