"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation } from "@tanstack/react-query";
import { researchApi } from "@/lib/api-client-research";
import type {
  CreateResearchRunInput,
  ResearchRunSummary,
} from "@opencairn/shared";

export interface NewResearchDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (runId: string) => void;
  workspaceId: string;
  projects: { id: string; name: string }[];
  managedEnabled: boolean;
}

type Model = ResearchRunSummary["model"];
type BillingPath = ResearchRunSummary["billingPath"];

export function NewResearchDialog({
  open,
  onClose,
  onCreated,
  workspaceId,
  projects,
  managedEnabled,
}: NewResearchDialogProps) {
  const t = useTranslations("research");
  const [topic, setTopic] = useState("");
  const [projectId, setProjectId] = useState<string>("");
  const [model, setModel] = useState<Model>("deep-research-preview-04-2026");
  const [billingPath, setBillingPath] = useState<BillingPath>("byok");
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (input: CreateResearchRunInput) => researchApi.createRun(input),
    onSuccess: ({ runId }) => onCreated(runId),
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  });

  if (!open) return null;

  const canSubmit = topic.trim().length > 0 && projectId.length > 0;

  return (
    <div
      role="dialog"
      aria-modal
      aria-label={t("new_dialog.title")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="bg-background w-[480px] max-w-[90vw] rounded-md border border-border p-6">
        <h2 className="mb-4 text-lg font-semibold">{t("new_dialog.title")}</h2>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!canSubmit || createMut.isPending) return;
            setError(null);
            createMut.mutate({
              workspaceId,
              projectId,
              topic: topic.trim(),
              model,
              billingPath,
            });
          }}
        >
          <label className="block text-sm">
            <span className="mb-1 block">{t("new_dialog.topic_label")}</span>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={t("new_dialog.topic_placeholder")}
              className="w-full rounded border border-border px-2 py-1"
              data-testid="research-topic"
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block">{t("new_dialog.project_label")}</span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="w-full rounded border border-border px-2 py-1"
            >
              <option value="">—</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="text-sm">
            <legend className="mb-1">{t("new_dialog.model_label")}</legend>
            <label className="mr-4">
              <input
                type="radio"
                name="model"
                checked={model === "deep-research-preview-04-2026"}
                onChange={() => setModel("deep-research-preview-04-2026")}
              />{" "}
              {t("model.deep_research")}
              <span className="text-muted-foreground ml-1 text-xs">
                ({t("model.cost_hint.deep_research")})
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="model"
                checked={model === "deep-research-max-preview-04-2026"}
                onChange={() => setModel("deep-research-max-preview-04-2026")}
              />{" "}
              {t("model.deep_research_max")}
              <span className="text-muted-foreground ml-1 text-xs">
                ({t("model.cost_hint.deep_research_max")})
              </span>
            </label>
          </fieldset>

          <fieldset className="text-sm">
            <legend className="mb-1">{t("new_dialog.billing_label")}</legend>
            <label className="mr-4 block">
              <input
                type="radio"
                name="billing"
                checked={billingPath === "byok"}
                onChange={() => setBillingPath("byok")}
              />{" "}
              {t("billing_path.byok")}
              <span className="text-muted-foreground ml-1 block text-xs">
                {t("billing_path.byok_help")}
              </span>
            </label>
            {managedEnabled && (
              <label className="block">
                <input
                  type="radio"
                  name="billing"
                  checked={billingPath === "managed"}
                  onChange={() => setBillingPath("managed")}
                />{" "}
                {t("billing_path.managed")}
                <span className="text-muted-foreground ml-1 block text-xs">
                  {t("billing_path.managed_help")}
                </span>
              </label>
            )}
          </fieldset>

          {error && <div className="text-sm text-red-600">{error}</div>}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border px-3 py-1 text-sm"
            >
              {t("new_dialog.cancel")}
            </button>
            <button
              type="submit"
              disabled={!canSubmit || createMut.isPending}
              className="bg-primary text-primary-foreground rounded px-3 py-1 text-sm disabled:opacity-50"
            >
              {createMut.isPending
                ? t("new_dialog.submitting")
                : t("new_dialog.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
