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
 *   - Approve emits onChange({approved: true, instructions, outputSchema, seedUrls,
 *     userResponse}), the userResponse carrying decision "approve" (issue 65).
 *   - Reject emits onChange({approved: false, userResponse}), the userResponse
 *     carrying decision "reject", so the run ends and no page is read.
 *   - Invalid JSON in the outputSchema textarea disables Approve and shows
 *     an inline error message.
 *   - Empty seedUrls disables Approve.
 *   - A value without the keys that the gate's message writes reads "The
 *     proposal could not be read.", with no fields and Approve disabled, while
 *     Reject stays. A proposal with empty values stays readable.
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
  plan: "Read the batch page",
};

function renderField(overrides: { value?: unknown } = {}) {
  const onChange = vi.fn();
  return {
    onChange,
    ...render(
      <ListCuratorScrapeSchemaRenderer
        fieldName="scrapeSchema"
        schema={{ "x-renderer": "@cinatra-ai/list-curator-agent:scrape-schema-review" }}
        value={"value" in overrides ? overrides.value : BASE_VALUE}
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
    const answer = JSON.parse((payload as unknown as { userResponse: string }).userResponse) as Record<string, unknown>;
    expect(answer).toEqual({
      decision: "approve",
      instructions: payload.instructions,
      outputSchema: payload.outputSchema,
      seedUrls: payload.seedUrls,
    });
  });

  it("Reject button calls onChange with approved:false and a reject answer", () => {
    const { onChange } = renderField();
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({
      approved: false,
      userResponse: JSON.stringify({ decision: "reject" }),
    });
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

  function expectUnreadable(onChange: ReturnType<typeof vi.fn>) {
    expect(screen.getByText("The proposal could not be read.")).toBeDefined();
    expect(screen.queryByLabelText(/output schema/i)).toBeNull();
    expect(screen.queryByLabelText(/instructions/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /add url/i })).toBeNull();
    const approve = screen.getByRole("button", { name: /approve/i }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    const reject = screen.getByRole("button", { name: /reject/i }) as HTMLButtonElement;
    expect(reject.disabled).toBe(false);
    fireEvent.click(approve);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(reject);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({
      approved: false,
      userResponse: JSON.stringify({ decision: "reject" }),
    });
  }

  it("blocks Approve but not Reject when the value has no outputSchema key or no plan key", () => {
    const { outputSchema: _schema, ...noSchema } = BASE_VALUE;
    const { plan: _plan, ...noPlan } = BASE_VALUE;
    const startInputsAlone = { intent: "find CTOs", seedUrls: ["https://start.test/s"], listName: "CTOs" };
    for (const value of [noSchema, noPlan, startInputsAlone]) {
      const { onChange } = renderField({ value });
      expectUnreadable(onChange);
      cleanup();
    }
  });

  it("blocks Approve but not Reject when the value is no object", () => {
    for (const value of [null, undefined, [], "not a value", 3, true]) {
      const { onChange } = renderField({ value });
      expectUnreadable(onChange);
      cleanup();
    }
  });

  it("blocks Approve but not Reject when the schema has another form", () => {
    for (const outputSchema of ["not a schema", 3, true, []]) {
      const { onChange } = renderField({ value: { ...BASE_VALUE, outputSchema } });
      expectUnreadable(onChange);
      cleanup();
    }
  });

  it("keeps a proposal with empty values readable, with the default schema and no seeds", () => {
    renderField({ value: { outputSchema: null, seedUrls: null, plan: null } });
    expect(screen.queryByText("The proposal could not be read.")).toBeNull();
    const schema = screen.getByLabelText(/output schema/i) as HTMLTextAreaElement;
    expect(JSON.parse(schema.value)).toEqual({ type: "object", properties: {} });
    expect(screen.getByText(/No seed URLs/)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /add url/i }));
    fireEvent.change(screen.getByPlaceholderText("https://example.com/path"), {
      target: { value: "https://added.test/a" },
    });
    const approve = screen.getByRole("button", { name: /approve/i }) as HTMLButtonElement;
    expect(approve.disabled).toBe(false);
  });

  it("Approve button is disabled when seedUrls is empty", () => {
    renderField({ value: { ...BASE_VALUE, seedUrls: [] } });
    const approveBtn = screen.getByRole("button", {
      name: /approve/i,
    }) as HTMLButtonElement;
    expect(approveBtn.disabled).toBe(true);
  });
});
