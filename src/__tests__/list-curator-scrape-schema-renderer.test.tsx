// @vitest-environment jsdom
/**
 * Vitest coverage for ListCuratorScrapeSchemaRenderer (relocated into the
 * claiming extension, cinatra#1625 S8/M3). Component-only assertions — the
 * binding-resolution/condition parity is proved host-side (the field-renderer
 * binding-parity + G2 cutover suites). Skipped in this repo's standalone CI
 * (first-party @cinatra-ai/* optional peers); the monorepo runs it.
 *
 * Asserts:
 *   - Mounts render the 3 fields (instructions, outputSchema textarea, seedUrls)
 *     plus the Approve + Reject buttons.
 *   - Approve emits onChange({approved: true, instructions, outputSchema, seedUrls}).
 *   - Reject emits onChange({approved: false}).
 *   - Invalid JSON in the outputSchema textarea disables Approve and shows
 *     an inline error message.
 *   - Empty seedUrls disables Approve.
 */
import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import type { FieldRendererProps } from "@cinatra-ai/sdk-ui/field-renderer-props";
import { ListCuratorScrapeSchemaRenderer } from "../list-curator-scrape-schema-renderer";

const MINIMAL_CONTEXT: FieldRendererProps["context"] = { connectedApps: [] };

const BASE_VALUE = {
  instructions: "Scrape YC W24 batch page",
  outputSchema: {
    type: "object",
    properties: { companyName: { type: "string" } },
  },
  seedUrls: ["https://www.ycombinator.com/companies?batch=W24"],
};

function renderField(overrides: { value?: unknown } = {}) {
  const onChange = vi.fn();
  return {
    onChange,
    ...render(
      <ListCuratorScrapeSchemaRenderer
        fieldName="scrapeSchema"
        schema={{ "x-renderer": "@cinatra-ai/list-curator-agent:scrape-schema-review" }}
        value={overrides.value ?? BASE_VALUE}
        onChange={onChange}
        context={MINIMAL_CONTEXT}
      />,
    ),
  };
}

describe("ListCuratorScrapeSchemaRenderer", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders Instructions textarea, Output schema textarea, seedUrls list, Approve + Reject buttons", () => {
    renderField();
    expect(screen.getByLabelText(/instructions/i)).toBeDefined();
    expect(screen.getByLabelText(/output schema/i)).toBeDefined();
    expect(
      screen.getByDisplayValue("https://www.ycombinator.com/companies?batch=W24"),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /approve/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /reject/i })).toBeDefined();
  });

  it("Approve button calls onChange with approved:true + instructions + outputSchema + seedUrls", () => {
    const { onChange } = renderField();
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const payload = onChange.mock.calls[0][0] as {
      approved: boolean;
      instructions: string;
      outputSchema: unknown;
      seedUrls: string[];
    };
    expect(payload.approved).toBe(true);
    expect(payload.instructions).toBe("Scrape YC W24 batch page");
    expect(payload.seedUrls).toEqual([
      "https://www.ycombinator.com/companies?batch=W24",
    ]);
    expect(payload.outputSchema).toMatchObject({ type: "object" });
  });

  it("Reject button calls onChange with approved:false", () => {
    const { onChange } = renderField();
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({ approved: false });
  });

  it("Approve button is disabled when outputSchema textarea has invalid JSON, and the inline error renders", () => {
    renderField();
    const schemaTextarea = screen.getByLabelText(
      /output schema/i,
    ) as HTMLTextAreaElement;
    fireEvent.change(schemaTextarea, { target: { value: "{not valid json" } });
    const approveBtn = screen.getByRole("button", {
      name: /approve/i,
    }) as HTMLButtonElement;
    expect(approveBtn.disabled).toBe(true);
    expect(screen.getByText(/invalid json/i)).toBeDefined();
  });

  it("Approve button is disabled when seedUrls is empty", () => {
    renderField({ value: { ...BASE_VALUE, seedUrls: [] } });
    const approveBtn = screen.getByRole("button", {
      name: /approve/i,
    }) as HTMLButtonElement;
    expect(approveBtn.disabled).toBe(true);
  });
});
