"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { CreateResearchRunInput } from "@opencairn/shared";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { researchApi } from "@/lib/api-client-research";
import { urls } from "@/lib/urls";

type BillingPath = CreateResearchRunInput["billingPath"];

export function DeepResearchLaunchDialog({
  open,
  workspaceId,
  projectId,
  wsSlug,
  billingPath,
  onOpenChange,
}: {
  open: boolean;
  workspaceId: string | null;
  projectId: string | null;
  wsSlug?: string;
  billingPath: BillingPath;
  onOpenChange(open: boolean): void;
}) {
  const t = useTranslations("project.tools.deepResearch");
  const locale = useLocale();
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const canSubmit =
    topic.trim().length > 0 &&
    Boolean(workspaceId) &&
    Boolean(projectId) &&
    Boolean(wsSlug) &&
    !submitting;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !workspaceId || !projectId || !wsSlug) return;
    setSubmitting(true);
    setError(false);
    try {
      const { runId } = await researchApi.createRun({
        workspaceId,
        projectId,
        topic: topic.trim(),
        model: "deep-research-preview-04-2026",
        billingPath,
      });
      onOpenChange(false);
      setTopic("");
      router.push(urls.workspace.researchRun(locale, wsSlug, runId));
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          <label className="space-y-1 text-sm font-medium text-foreground">
            <span>{t("topicLabel")}</span>
            <textarea
              value={topic}
              onChange={(event) => setTopic(event.currentTarget.value)}
              placeholder={t("topicPlaceholder")}
              className="min-h-28 w-full resize-y rounded-[var(--radius-control)] border border-border bg-background px-3 py-2 text-sm font-normal"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {t(`billing.${billingPath}`)}
          </p>
          {error ? (
            <p role="alert" className="text-xs text-red-600">
              {t("error")}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {submitting ? t("starting") : t("start")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
