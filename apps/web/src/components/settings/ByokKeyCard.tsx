"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ByokKeyApiError,
  byokKeyQueryKey,
  deleteByokKey,
  getByokKey,
  setByokKey,
  type ByokKeyStatus,
} from "@/lib/api-client-byok-key";

const KNOWN_ERROR_CODES = new Set([
  "wrong_prefix",
  "too_short",
  "too_long",
]);

export function ByokKeyCard() {
  const t = useTranslations("settings.ai.byok");
  const qc = useQueryClient();

  const status = useQuery({
    queryKey: byokKeyQueryKey(),
    queryFn: getByokKey,
  });

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const saveMutation = useMutation({
    mutationFn: (apiKey: string) => setByokKey(apiKey),
    onSuccess: (next) => {
      qc.setQueryData(byokKeyQueryKey(), next);
      setDraft("");
      setEditing(false);
      setErrorCode(null);
      toast.success(t("saved"));
    },
    onError: (err: unknown) => {
      const code =
        err instanceof ByokKeyApiError && KNOWN_ERROR_CODES.has(err.code)
          ? err.code
          : "save_failed";
      setErrorCode(code);
      if (code === "save_failed") toast.error(t("error.save_failed"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteByokKey(),
    onSuccess: () => {
      qc.setQueryData(byokKeyQueryKey(), { registered: false });
      setDeleteOpen(false);
      toast.success(t("deleted"));
    },
    onError: () => toast.error(t("error.delete_failed")),
  });

  if (status.isLoading) {
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;
  }

  if (status.isError) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {t("error.load_failed")}
      </p>
    );
  }

  const data = status.data as ByokKeyStatus;
  const showInput = !data.registered || editing;

  return (
    <section className="rounded-lg border border-border p-6">
      <h2 className="text-base font-medium">{t("heading")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>

      {showInput ? (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.trim()) return;
            saveMutation.mutate(draft.trim());
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span>{t("input_label")}</span>
            <Input
              type="password"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                if (errorCode) setErrorCode(null);
              }}
              placeholder={t("input_placeholder")}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {errorCode ? (
            <p className="text-sm text-destructive" role="alert">
              {t(`error.${errorCode}`)}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">{t("help_text")}</p>
          <div className="flex justify-end gap-2">
            {data.registered ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEditing(false);
                  setDraft("");
                  setErrorCode(null);
                }}
              >
                {t("delete_confirm_no")}
              </Button>
            ) : null}
            <Button
              type="submit"
              disabled={saveMutation.isPending || !draft.trim()}
            >
              {saveMutation.isPending ? t("saving") : t("save")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col">
            <span className="text-sm">
              <span aria-hidden>••••</span>
              <span className="ml-1 font-mono">{data.lastFour}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              {t("last_updated")}: {new Date(data.updatedAt).toLocaleString()}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              {t("replace")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(true)}
            >
              {t("delete")}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("delete_confirm_title")}</DialogTitle>
            <DialogDescription>{t("delete_confirm_body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteMutation.isPending}
            >
              {t("delete_confirm_no")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? t("deleting") : t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
