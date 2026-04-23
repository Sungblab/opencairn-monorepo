import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, integer, check } from "drizzle-orm/pg-core";
import { byteaU8 } from "./custom-types";

// 4 MB. Chosen as an order-of-magnitude ceiling: realistic collab docs are
// well under 1 MB even after heavy history, so anything above this is
// almost certainly either (a) a pathological app bug or (b) an attempt to
// wedge the table. Raise deliberately if a real use case justifies it.
export const YJS_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;

// Hocuspocus가 저장/로드할 Yjs 문서 상태. `byteaU8`는 Uint8Array in/out으로 Y.Doc과
// 직접 호환되며, postgres 컬럼은 일반 `bytea`와 동일.
//
// size_bytes + CHECK(octet_length(state) <= cap): the column is a denormalised
// metric for fast rollups ("show me workspaces with pathological docs"), the
// CHECK is the authoritative guard — it fires regardless of whether an app
// happens to populate size_bytes correctly. See Plan 2B H-3 in the Tier 2
// post-hoc review.
export const yjsDocuments = pgTable(
  "yjs_documents",
  {
    name: text("name").primaryKey(),
    state: byteaU8("state").notNull(),
    stateVector: byteaU8("state_vector").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "yjs_documents_state_size_check",
      sql`octet_length(${t.state}) <= ${sql.raw(String(YJS_DOCUMENT_MAX_BYTES))}`,
    ),
  ],
);
