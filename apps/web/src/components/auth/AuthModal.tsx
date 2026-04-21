"use client";
import { useTranslations, useLocale } from "next-intl";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { GoogleButton } from "./GoogleButton";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuthModal({ open, onOpenChange }: AuthModalProps) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="max-w-sm p-6 gap-0">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h2 className="font-serif text-xl text-stone-900">{t("modal.title")}</h2>
            <p className="text-sm text-stone-500">{t("modal.desc")}</p>
          </div>

          <GoogleButton />

          <div className="flex items-center gap-3 text-xs text-stone-400">
            <hr className="flex-1 border-stone-200" />
            <span>{t("modal.or")}</span>
            <hr className="flex-1 border-stone-200" />
          </div>

          <a
            href={`/${locale}/auth/login`}
            onClick={close}
            className="flex items-center justify-center w-full border border-stone-200 rounded-md py-2.5 text-sm font-medium text-stone-700 hover:bg-stone-50 transition-colors"
          >
            {t("modal.emailLogin")}
          </a>

          <p className="text-center text-xs text-stone-500">
            {t("modal.noAccount")}{" "}
            <a
              href={`/${locale}/auth/signup`}
              onClick={close}
              className="font-medium text-stone-900 hover:underline"
            >
              {t("modal.signUp")}
            </a>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
