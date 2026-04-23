// Strict RFC 4122 / 9562: version nibble 1-8, variant bits 10xx (8/9/a/b).
// Rejects nil UUID (all-zeros, version 0), version-0 siblings, and malformed
// hyphen positions. All UUIDs we emit (crypto.randomUUID → v4, Postgres
// gen_random_uuid → v4) satisfy this, as do v7 keys clients may send.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isUuid(s: string | undefined): s is string {
  return !!s && UUID_RE.test(s);
}
