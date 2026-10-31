// @vitest-environment jsdom
/**
 * Vitest coverage for ListCuratorFinalListRenderer (relocated into the claiming
 * extension, cinatra#1625 S8/M3). Component-only assertions — the
 * binding-resolution/condition parity is proved host-side (the field-renderer
 * binding-parity + G2 cutover suites). Skipped in this repo's standalone CI
 * (first-party @cinatra-ai/* optional peers); the monorepo runs it.
 *
 * Asserts:
 *   - Mounts render the listName Input, the members of the value that the
 *     flow's list_gate inputs give (candidateMembers), and the Approve list +
 *     Cancel buttons (issue 72).
 *   - A member's label is a name-like string field of its row, else
 *     "Member N". The screen never draws a row's raw keys or JSON.
 *   - Approve emits onChange({approved: true, listName, userResponse}), the
 *     userResponse carrying decision "approve" (issue 65: the run reads the
 *     decision from the answer the host sends, and a renderer-authored
 *     userResponse is that answer).
 *   - Cancel emits onChange({approved: false, userResponse}), the userResponse
 *     carrying decision "reject", so the run ends and creates no list. CRM
 *     records that discovery wrote before this review may already exist.
 *   - Approve is disabled when listName is empty.
 *   - Failures section renders when failures.length > 0.
 */
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import React from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

import type { FieldRendererProps } from "@cinatra-ai/sdk-ui/field-renderer-props";
import { ListCuratorFinalListRenderer } from "../list-curator-final-list-renderer";

const MINIMAL_CONTEXT: FieldRendererProps["context"] = { connectedApps: [] };

const oas = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../cinatra/oas.json"),
    "utf8",
  ),
);

// The value that the flow's list_gate inputs give: its keys are read against
// the flow in the first test below.
const BASE_VALUE = {
  candidateMembers: [
    { name: "Acme Corp", domain: "acme.test" },
    { name: "Jane Founder", email: "jane@acme.test" },
  ],
  listName: "YC W24 Founders",
  dispatchedRuns: [],
  failures: [],
};

function withMembers(candidateMembers: unknown) {
  return { ...BASE_VALUE, candidateMembers };
}

function renderField(overrides: { value?: unknown } = {}) {
  const onChange = vi.fn();
  return {
    onChange,
    ...render(
      <ListCuratorFinalListRenderer
        fieldName="finalList"
        schema={{ "x-renderer": "@cinatra-ai/list-curator-agent:final-list-review" }}
        value={overrides.value ?? BASE_VALUE}
        onChange={onChange}
        context={MINIMAL_CONTEXT}
      />,
    ),
  };
}

describe("ListCuratorFinalListRenderer", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("takes the value that the list_gate inputs of the flow give", () => {
    const inputs = oas.$referenced_components.list_gate.inputs.map(
      (input: { title: string }) => input.title,
    );
    expect(Object.keys(BASE_VALUE).sort()).toEqual([...inputs].sort());
  });

  it("renders List name input, the members, Approve list + Cancel buttons", () => {
    renderField();
    expect(screen.getByLabelText(/list name/i)).toBeDefined();
    expect(screen.getByDisplayValue("YC W24 Founders")).toBeDefined();
    expect(screen.getByText("Acme Corp")).toBeDefined();
    expect(screen.getByText("Jane Founder")).toBeDefined();
    expect(screen.getByText("2 members")).toBeDefined();
    expect(screen.queryByText("No members.")).toBeNull();
    expect(screen.getByRole("button", { name: /approve list/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDefined();
  });

  it("Approve list calls onChange with approved:true + listName", () => {
    const { onChange } = renderField();
    fireEvent.click(screen.getByRole("button", { name: /approve list/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({
      approved: true,
      listName: "YC W24 Founders",
      userResponse: JSON.stringify({ decision: "approve", listName: "YC W24 Founders" }),
    });
  });

  it("Cancel button calls onChange with approved:false and a reject answer", () => {
    const { onChange } = renderField();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({
      approved: false,
      userResponse: JSON.stringify({ decision: "reject" }),
    });
  });

  it("Approve list is disabled when listName is empty", () => {
    renderField({ value: { ...BASE_VALUE, listName: "" } });
    const btn = screen.getByRole("button", {
      name: /approve list/i,
    }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("labels a member from a name-like string field, in any spelling of its key", () => {
    renderField({
      value: withMembers([
        { full_name: "Ann Lee" },
        { DisplayName: "Bea Ray" },
        { "company name": "Cedar Ltd" },
        { accountName: "Dune Inc", name: "Eve Moss" },
      ]),
    });
    expect(screen.getByText("Ann Lee")).toBeDefined();
    expect(screen.getByText("Bea Ray")).toBeDefined();
    expect(screen.getByText("Cedar Ltd")).toBeDefined();
    expect(screen.getByText("Eve Moss")).toBeDefined();
    expect(screen.queryByText("Dune Inc")).toBeNull();
  });

  it('labels every other row "Member N", and draws no raw key or JSON of it', () => {
    const { container } = renderField({
      value: withMembers([
        { email: "raw-email@acme.test", title: "raw-title" },
        { name: 7 },
        { name: "   " },
        { name: '{"raw-json":1}' },
        { name: "[raw-list]" },
        null,
        "raw-string",
        3,
        ["raw-item"],
      ]),
    });
    for (let n = 1; n <= 9; n += 1) {
      expect(screen.getByText(`Member ${n}`)).toBeDefined();
    }
    expect(screen.getByText("9 members")).toBeDefined();
    expect(container.textContent).not.toMatch(/raw-|email|title|\{|\[/);
  });

  it("reads one member and no members in their own words", () => {
    renderField({ value: withMembers([{ name: "Ann Lee" }]) });
    expect(screen.getByText("1 member")).toBeDefined();
    cleanup();
    renderField({ value: withMembers([]) });
    expect(screen.getByText("0 members")).toBeDefined();
    expect(screen.getByText("No members.")).toBeDefined();
    cleanup();
    renderField({ value: withMembers({ name: "not a list" }) });
    expect(screen.getByText("0 members")).toBeDefined();
    expect(screen.getByText("No members.")).toBeDefined();
  });

  it("reads no value that the run does not give this review", () => {
    const { container } = renderField({
      value: {
        ...BASE_VALUE,
        memberRefs: [{ objectType: "x:contact", objectId: "ct_hand", displayName: "Hand Written" }],
        memberCount: 40,
        accountsCreated: 5,
        contactsCreated: 6,
      },
    });
    expect(screen.queryByText("Hand Written")).toBeNull();
    expect(screen.getByText("2 members")).toBeDefined();
    expect(container.textContent).not.toMatch(/created/);
  });

  it("renders failures section when failures.length > 0", () => {
    renderField({
      value: {
        ...BASE_VALUE,
        failures: [
          { rowIndex: 2, stage: "company-discovery", error: "no_domain" },
        ],
      },
    });
    expect(screen.getByText(/company-discovery/i)).toBeDefined();
    expect(screen.getByText(/no_domain/i)).toBeDefined();
    expect(screen.getByText(/failures \(1\)/i)).toBeDefined();
  });
});
