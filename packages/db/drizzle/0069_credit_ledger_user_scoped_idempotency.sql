DROP INDEX IF EXISTS "credit_ledger_entries_idempotency_key_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_entries_user_idempotency_key_idx"
  ON "credit_ledger_entries" USING btree ("user_id", "idempotency_key")
  WHERE "credit_ledger_entries"."idempotency_key" IS NOT NULL;
