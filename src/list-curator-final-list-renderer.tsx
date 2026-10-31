"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@cinatra-ai/design-primitives";

import type { FieldRendererProps } from "@cinatra-ai/sdk-ui/field-renderer-props";

// ---------------------------------------------------------------------------
// Condition
// ---------------------------------------------------------------------------

// Condition: registered from the manifest binding (kind "final-list-review")
// with strict ID matching — the host resolves this migrated component through
// the generated field-renderer component map keyed by the binding id
// (@cinatra-ai/list-curator-agent:final-list-review).

// ---------------------------------------------------------------------------
// Value shape
// ---------------------------------------------------------------------------

type FailureItem = {
  rowIndex?: number;
  stage?: string;
  error?: string;
  accountId?: string;
};

type FinalListValue = {
  listName: string;
  // The rows that create receives. Their members are set by the schema the
  // person approved for this run, so a row can hold anything.
  candidateMembers: unknown[];
  failures: FailureItem[];
};

function toFinalListValue(value: unknown): FinalListValue {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    const failures = Array.isArray(v.failures)
      ? (v.failures.filter(
          (f) => f && typeof f === "object",
        ) as FailureItem[])
      : [];
    return {
      listName: typeof v.listName === "string" ? v.listName : "",
      candidateMembers: Array.isArray(v.candidateMembers) ? v.candidateMembers : [],
      failures,
    };
  }
  return {
    listName: "",
    candidateMembers: [],
    failures: [],
  };
}

// The keys that name a member, in order of preference, as memberLabel compares
// them: lower case, with no space, underscore or hyphen. A key like "title" or
// "email" is no name, so it is left out.
const NAME_KEYS = [
  "name",
  "fullname",
  "displayname",
  "companyname",
  "accountname",
  "contactname",
  "organizationname",
  "organisationname",
  "personname",
  "membername",
];

/** The label of a row: a name-like string field, else "Member N". Never a raw key or JSON. */
function memberLabel(row: unknown, index: number): string {
  const fallback = `Member ${index + 1}`;
  if (!row || typeof row !== "object" || Array.isArray(row)) return fallback;
  const byKey = new Map<string, string>();
  for (const [key, field] of Object.entries(row)) {
    if (typeof field !== "string") continue;
    const name = key.toLowerCase().replace(/[\s_-]/g, "");
    if (!byKey.has(name)) byKey.set(name, field.trim());
  }
  for (const key of NAME_KEYS) {
    const label = byKey.get(key);
    if (label && !/^[{[]/.test(label)) return label;
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function ListCuratorFinalListRenderer({
  value,
  onChange,
  disabled,
}: FieldRendererProps) {
  const v = useMemo(() => toFinalListValue(value), [value]);
  const [listName, setListName] = useState<string>(v.listName);

  // Stable onChange ref.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const approveDisabled = disabled === true || listName.trim() === "";

  // The run reads its next step from the answer this screen sends (issue 65):
  // the host forwards a renderer-authored `userResponse` to the paused review as
  // the answer text (inside the attachment envelope when attachments are
  // pending), and the flow's decision step reads its `decision` field. Without
  // it the host sends an answer that carries no decision, which the flow reads
  // as an approval, so a reject here would still let the run go on.
  const handleApprove = () => {
    if (listName.trim() === "") return;
    onChangeRef.current({
      approved: true,
      listName,
      userResponse: JSON.stringify({ decision: "approve", listName }),
    });
  };

  const handleCancel = () => {
    onChangeRef.current({
      approved: false,
      userResponse: JSON.stringify({ decision: "reject" }),
    });
  };

  return (
    <Card className="border-line bg-surface backdrop-blur-none">
      <CardHeader>
        <CardTitle>Review final list</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="list-curator-list-name">List name</Label>
          <Input
            id="list-curator-list-name"
            value={listName}
            onChange={(e) => setListName(e.target.value)}
            placeholder="Final list name"
            disabled={disabled === true}
          />
        </div>

        <Card className="border-line bg-surface-muted backdrop-blur-none">
          <CardContent className="flex flex-wrap gap-2 py-3">
            <Badge variant="secondary">
              {v.candidateMembers.length}{" "}
              {v.candidateMembers.length === 1 ? "member" : "members"}
            </Badge>
          </CardContent>
        </Card>

        <Card className="border-line bg-surface backdrop-blur-none">
          <CardHeader>
            <CardTitle className="text-base">Members</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {v.candidateMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members.</p>
            ) : (
              v.candidateMembers.map((row, idx) => (
                <p key={idx} className="text-sm text-foreground">
                  {memberLabel(row, idx)}
                </p>
              ))
            )}
          </CardContent>
        </Card>

        {v.failures.length > 0 && (
          <Card className="border-destructive/40 bg-surface backdrop-blur-none">
            <CardHeader>
              <CardTitle className="text-base text-destructive">
                Failures ({v.failures.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {v.failures.map((f, idx) => (
                <p
                  key={idx}
                  className="text-sm text-destructive"
                >
                  {f.rowIndex !== undefined ? `row ${f.rowIndex} ` : ""}
                  {f.stage ?? "unknown"}: {f.error ?? "unknown error"}
                  {f.accountId !== undefined ? ` (accountId=${f.accountId})` : ""}
                </p>
              ))}
            </CardContent>
          </Card>
        )}
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button
          variant="default"
          onClick={handleApprove}
          disabled={approveDisabled}
        >
          Approve list
        </Button>
        <Button variant="outline" onClick={handleCancel} disabled={disabled === true}>
          Cancel
        </Button>
      </CardFooter>
    </Card>
  );
}

export default ListCuratorFinalListRenderer;
