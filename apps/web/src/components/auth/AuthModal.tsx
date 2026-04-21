"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { LoginForm } from "./LoginForm";
import { SignupForm } from "./SignupForm";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: "login" | "signup";
}

export function AuthModal({ open, onOpenChange, defaultTab = "login" }: AuthModalProps) {
  const t = useTranslations("auth");
  const [tab, setTab] = useState<"login" | "signup">(defaultTab);

  useEffect(() => {
    if (open) setTab(defaultTab);
  }, [open, defaultTab]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="max-w-sm p-0 overflow-hidden gap-0">
        <div className="flex border-b border-stone-200">
          <button
            type="button"
            onClick={() => setTab("login")}
            className={`flex-1 py-3.5 text-sm font-medium transition-colors ${
              tab === "login"
                ? "text-stone-900 border-b-2 border-stone-900 -mb-px"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            {t("modal.loginTab")}
          </button>
          <button
            type="button"
            onClick={() => setTab("signup")}
            className={`flex-1 py-3.5 text-sm font-medium transition-colors ${
              tab === "signup"
                ? "text-stone-900 border-b-2 border-stone-900 -mb-px"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            {t("modal.signupTab")}
          </button>
        </div>

        <div className="p-6">
          {tab === "login" ? (
            <LoginForm onSuccess={() => onOpenChange(false)} />
          ) : (
            <SignupForm />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
