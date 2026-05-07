"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ReportIssueClient() {
  const t = useTranslations("admin.reportForm");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("bug");
  const [priority, setPriority] = useState("normal");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSent(false);
    const res = await fetch("/api/site-reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type,
        priority,
        title,
        description,
        pageUrl: window.location.href,
        metadata: {
          userAgent: window.navigator.userAgent,
          language: window.navigator.language,
        },
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(t("error"));
      return;
    }
    setSent(true);
    setTitle("");
    setDescription("");
    setType("bug");
    setPriority("normal");
  }

  return (
    <form onSubmit={submit} className="border border-border bg-card">
      <div className="border-b border-border bg-muted/40 px-4 py-3">
        <h2 className="text-sm font-bold uppercase tracking-wide">{t("panelTitle")}</h2>
      </div>
      <div className="grid gap-4 p-4">
        {sent ? (
          <div className="flex items-center gap-2 border border-green-600 bg-background px-3 py-2 text-sm font-semibold text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {t("success")}
          </div>
        ) : null}
        {error ? (
          <div className="flex items-center gap-2 border border-destructive bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {error}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-semibold">
            {t("type")}
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
              className="h-10 border border-border bg-background px-2"
            >
              {["bug", "feedback", "billing", "security", "other"].map((value) => (
                <option key={value} value={value}>{t(`types.${value}`)}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            {t("priority")}
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              className="h-10 border border-border bg-background px-2"
            >
              {["low", "normal", "high", "urgent"].map((value) => (
                <option key={value} value={value}>{t(`priorities.${value}`)}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="grid gap-1 text-sm font-semibold">
          {t("fieldTitle")}
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            minLength={3}
            maxLength={160}
            className="rounded-none"
          />
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          {t("description")}
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={4000}
            rows={8}
            className="rounded-none"
          />
        </label>
        <div className="flex justify-end">
          <Button type="submit" disabled={busy}>
            {busy ? t("submitting") : t("submit")}
          </Button>
        </div>
      </div>
    </form>
  );
}
