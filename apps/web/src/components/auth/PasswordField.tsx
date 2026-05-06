"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  showLabel: string;
  hideLabel: string;
  labelAction?: ReactNode;
  autoFocus?: boolean;
  minLength?: number;
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  showLabel,
  hideLabel,
  labelAction,
  autoFocus,
  minLength,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? hideLabel : showLabel;
  const Icon = visible ? EyeOff : Eye;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="auth-label">
          {label}
        </label>
        {labelAction}
      </div>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          minLength={minLength}
          required
          className="auth-input pr-12"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={toggleLabel}
          title={toggleLabel}
          className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-stone-600 transition-colors hover:bg-stone-900 hover:text-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
        >
          <Icon className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
