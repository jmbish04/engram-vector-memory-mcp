import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const memories = sqliteTable(
  "memories",
  {
    id: text("id").primaryKey(),
    text: text("text").notNull(),
    tags: text("tags"), // Storing as JSON string or comma-separated values
    sourceApp: text("source_app"),
    sessionId: text("session_id"),
    status: text("status").default("raw"), // raw, consolidated, processed
    createdAt: integer("created_at", { mode: "number" }).notNull(),
    updatedAt: integer("updated_at", { mode: "number" })
      .notNull()
      .default(sql`(strftime('%s', 'now') * 1000)`),
  },
  (table) => ({
    sessionIdIdx: index("session_id_idx").on(table.sessionId),
    sourceAppIdx: index("source_app_idx").on(table.sourceApp),
    createdAtIdx: index("created_at_idx").on(table.createdAt),
    statusIdx: index("status_idx").on(table.status),
  })
);
