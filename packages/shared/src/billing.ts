export const userPlanValues = ["free", "pro", "max", "byok"] as const;
export type UserPlan = (typeof userPlanValues)[number];

export type BillingPlanConfig = {
  plan: UserPlan;
  monthlyPriceKrw: number;
  includedMonthlyCredits: number;
  managedLlm: boolean;
  byokAllowed: boolean;
};

export const billingPlanConfigs = {
  free: {
    plan: "free",
    monthlyPriceKrw: 0,
    includedMonthlyCredits: 500,
    managedLlm: true,
    byokAllowed: false,
  },
  byok: {
    plan: "byok",
    monthlyPriceKrw: 4_900,
    includedMonthlyCredits: 0,
    managedLlm: false,
    byokAllowed: true,
  },
  pro: {
    plan: "pro",
    monthlyPriceKrw: 9_900,
    includedMonthlyCredits: 8_000,
    managedLlm: true,
    byokAllowed: false,
  },
  max: {
    plan: "max",
    monthlyPriceKrw: 19_900,
    includedMonthlyCredits: 18_000,
    managedLlm: true,
    byokAllowed: false,
  },
} satisfies Record<UserPlan, BillingPlanConfig>;

export function formatKrwAmount(amount: number): string {
  return `₩${Math.trunc(amount).toLocaleString("ko-KR")}`;
}
