"use client";
import { useTranslations, useLocale } from "next-intl";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { GoogleButton } from "./GoogleButton";
import { AuthEyebrow } from "./AuthEyebrow";
import { googleOAuthEnabled } from "@/lib/auth-client";

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
      <DialogContent
        showCloseButton
        className="sm:max-w-md p-0 gap-0 rounded-xl border-2 border-stone-900 ring-0 shadow-[0_6px_0_0_#171717]"
      >
        <div className="flex flex-col gap-6 p-7 sm:p-8">
          <div className="flex flex-col gap-3">
            <AuthEyebrow label={t("modal.eyebrow")} />
            <h2 className="font-sans text-2xl font-bold leading-tight text-stone-900 kr">
              {t("modal.title")}
            </h2>
            <p className="text-sm text-stone-600 kr">{t("modal.desc")}</p>
          </div>

          <div className="flex flex-col gap-3">
            {googleOAuthEnabled && (
              <>
                <GoogleButton />
                <div className="auth-divider">
                  <span>{t("modal.or")}</span>
                </div>
              </>
            )}

            <a
              href={`/${locale}/auth/login`}
              onClick={close}
              className="auth-btn auth-btn-secondary w-full kr"
            >
              {t("modal.emailLogin")}
            </a>
          </div>

          <p className="text-center text-sm text-stone-600 kr">
            {t("modal.noAccount")}{" "}
            <a
              href={`/${locale}/auth/signup`}
              onClick={close}
              className="font-bold text-stone-900 underline underline-offset-2 decoration-2 hover:bg-stone-900 hover:text-stone-50 hover:no-underline px-1.5 py-0.5 rounded transition-colors"
            >
              {t("modal.signUp")}
            </a>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
