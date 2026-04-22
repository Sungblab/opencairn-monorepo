"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

// Ambient stone cairn that auto-stacks from 0 → 10 and loops forever.
// At milestones 1 · 3 · 6 · 10 an editorial quip appears beside the stack.
// Echoes the product name (OpenCairn = stone cairn marker).

const BASE_STONES = [
  { w: 176, h: 22 },
  { w: 140, h: 20 },
  { w: 108, h: 17 },
  { w: 80, h: 15 },
  { w: 58, h: 13 },
  { w: 40, h: 11 },
] as const;

const BONUS_STONES = [
  { w: 28, h: 9 },
  { w: 22, h: 8 },
  { w: 18, h: 7 },
  { w: 14, h: 6 },
] as const;

const ALL_STONES = [...BASE_STONES, ...BONUS_STONES];
const TOTAL = ALL_STONES.length; // 10

const STACK_INTERVAL_MS = 1100;
const HOLD_AT_FULL_MS = 2400;
const HOLD_AT_EMPTY_MS = 500;

export function AuthCairn() {
  const t = useTranslations("auth.layout");
  const [count, setCount] = useState(0);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setCount(TOTAL);
      return;
    }

    // Drive the loop with plain local state so React StrictMode's
    // double-invocation of state updaters can't duplicate timers.
    let active = true;
    let handle: ReturnType<typeof setTimeout> | undefined;
    let current = 0;

    const schedule = (delay: number, fn: () => void) => {
      handle = setTimeout(() => {
        if (active) fn();
      }, delay);
    };

    const reset = () => {
      current = 0;
      setCount(0);
      schedule(HOLD_AT_EMPTY_MS, step);
    };

    const step = () => {
      current += 1;
      setCount(current);
      if (current < TOTAL) {
        schedule(STACK_INTERVAL_MS, step);
      } else {
        schedule(HOLD_AT_FULL_MS, reset);
      }
    };

    schedule(STACK_INTERVAL_MS, step);

    return () => {
      active = false;
      if (handle) clearTimeout(handle);
    };
  }, []);

  const milestone =
    count >= 10 ? 10 : count >= 6 ? 6 : count >= 3 ? 3 : count >= 1 ? 1 : 0;
  const quip =
    milestone === 10
      ? t("cairnQuip10")
      : milestone === 6
        ? t("cairnQuip6")
        : milestone === 3
          ? t("cairnQuip3")
          : milestone === 1
            ? t("cairnQuip1")
            : "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-6">
        {/* STACK */}
        <div className="flex flex-col-reverse items-center gap-[4px] min-h-[176px] justify-end">
          {ALL_STONES.map((s, i) => {
            // reverse: bottom of cairn (index 0) should appear first as count grows
            const reversedIdx = TOTAL - 1 - i;
            const visible = reversedIdx < count;
            const isBonus = i >= BASE_STONES.length;
            return (
              <span
                key={i}
                className={`block rounded-full border transition-all duration-500 ${
                  isBonus
                    ? "bg-stone-400 border-stone-300"
                    : "bg-stone-700 border-stone-600"
                }`}
                style={{
                  width: s.w,
                  height: s.h,
                  opacity: visible ? 1 : 0,
                  transform: visible
                    ? "translateY(0) scale(1)"
                    : "translateY(6px) scale(0.94)",
                }}
              />
            );
          })}
        </div>

        {/* QUIP — keyed on milestone so it re-animates on each threshold */}
        <div className="min-h-[28px] max-w-[170px]">
          {milestone > 0 && (
            <p
              key={milestone}
              className="cairn-quip font-sans text-[17px] font-medium text-stone-100 leading-snug kr"
            >
              {quip}
            </p>
          )}
        </div>
      </div>

      <span className="font-sans text-[10px] tracking-[0.22em] uppercase text-stone-500 tabular-nums">
        {t("cairnLabel")} · {String(count).padStart(2, "0")}/
        {String(TOTAL).padStart(2, "0")}
      </span>
    </div>
  );
}
