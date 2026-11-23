import { customType, date, index, integer, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id } from '../columns';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** One shared Morning Decode per UTC day (script stored server-side; clients get audio only). */
export const aiMarketBriefs = pgTable(
  'ai_market_briefs',
  {
    id: id(),
    briefDate: date().notNull(),
    /** Spoken script — never returned on the public Morning Decode metadata endpoint. */
    content: text().notNull(),
    audio: bytea('audio'),
    audioContentType: varchar({ length: 80 }),
    durationSeconds: integer(),
    textModel: varchar({ length: 100 }),
    audioModel: varchar({ length: 100 }),
    createdAt: createdAt(),
  },
  t => [
    uniqueIndex('ai_market_briefs_date_uq').on(t.briefDate),
    index('ai_market_briefs_created_idx').on(t.createdAt.desc()),
  ],
);

export type AiMarketBriefRow = typeof aiMarketBriefs.$inferSelect;
