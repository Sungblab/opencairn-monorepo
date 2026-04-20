export const FREE_PLAN_LIMITS = {
  monthlyIngests: 10,
  monthlyQA: 50,
  monthlyAudio: 3,
  storageBytes: 100 * 1024 * 1024, // 100MB
} as const;

export const PRO_PLAN_LIMITS = {
  monthlyIngests: Infinity,
  monthlyQA: Infinity,
  monthlyAudio: Infinity,
  storageBytes: 10 * 1024 * 1024 * 1024, // 10GB
} as const;
