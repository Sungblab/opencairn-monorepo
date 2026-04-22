import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { byteaU8 } from "./custom-types";

// Hocuspocus가 저장/로드할 Yjs 문서 상태. `byteaU8`는 Uint8Array in/out으로 Y.Doc과
// 직접 호환되며, postgres 컬럼은 일반 `bytea`와 동일.
export const yjsDocuments = pgTable("yjs_documents", {
  name: text("name").primaryKey(),
  state: byteaU8("state").notNull(),
  stateVector: byteaU8("state_vector").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
