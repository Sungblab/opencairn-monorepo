/**
 * Parse a non-negative finite integer from an environment variable.
 * Logs a warning + falls back to `fallback` if the env is set but unparseable.
 */
export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[env] ${name}=${JSON.stringify(raw)} is not a non-negative finite number; using fallback ${fallback}`,
    );
    return fallback;
  }
  return parsed;
}
