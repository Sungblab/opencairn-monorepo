"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

// Mirror of @opencairn/shared ImportTarget. We redeclare rather than import
// because the web app isn't (yet) a @opencairn/shared consumer — inlining
// keeps the bundle trim and avoids a workspace dep for one tiny type.
// Must stay in sync with packages/shared/src/import-types.ts.
export type ImportTarget =
  | { kind: "new" }
  | { kind: "existing"; projectId: string; parentNoteId: string | null };

// Deliberately inline the project fetch — the /import page is the only
// caller in this wsSlug scope and building a dedicated hook for one use
// site would inflate the codebase without clarifying anything. If a second
// consumer appears, lift this into apps/web/src/hooks/.
async function fetchProjects(
  wsSlug: string,
): Promise<Array<{ id: string; name: string }>> {
  const wsRes = await fetch(`/api/workspaces/by-slug/${wsSlug}`, {
    credentials: "include",
  });
  if (!wsRes.ok) return [];
  const ws = (await wsRes.json()) as { id: string };
  const projRes = await fetch(`/api/workspaces/${ws.id}/projects`, {
    credentials: "include",
  });
  if (!projRes.ok) return [];
  return (await projRes.json()) as Array<{ id: string; name: string }>;
}

export function TargetPicker({
  wsSlug,
  value,
  onChange,
}: {
  wsSlug: string;
  value: ImportTarget;
  onChange: (t: ImportTarget) => void;
}) {
  const t = useTranslations("import.target");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>(
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetchProjects(wsSlug).then((p) => {
      if (!cancelled) setProjects(p);
    });
    return () => {
      cancelled = true;
    };
  }, [wsSlug]);

  const existingProjectId =
    value.kind === "existing" ? value.projectId : "";

  return (
    <fieldset className="mt-4 space-y-2">
      <legend className="text-sm font-medium">{t("label")}</legend>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="import-target"
          checked={value.kind === "new"}
          onChange={() => onChange({ kind: "new" })}
        />
        {t("new")}
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="radio"
          name="import-target"
          checked={value.kind === "existing"}
          onChange={() => {
            // Need a project to land "existing" — pick the first if available,
            // otherwise stay on "new" until the user selects one.
            if (projects.length > 0) {
              onChange({
                kind: "existing",
                projectId: projects[0].id,
                parentNoteId: null,
              });
            } else {
              onChange({ kind: "new" });
            }
          }}
        />
        {t("existing")}
      </label>

      {value.kind === "existing" && (
        <select
          className="mt-2 block w-full rounded border border-border bg-background px-3 py-2 text-sm"
          value={existingProjectId}
          onChange={(e) =>
            onChange({
              kind: "existing",
              projectId: e.target.value,
              parentNoteId: null,
            })
          }
        >
          <option value="" disabled>
            {t("selectProject")}
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </fieldset>
  );
}
