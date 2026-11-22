import { customType, date, index, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id } from '../columns';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/** One global market brief per UTC calendar day (text + optional OpenRouter TTS audio). */
export const aiMarketBriefs = pgTable(
  'ai_market_briefs',
  {
    id: id(),
    briefDate: date().notNull(),
    content: text().notNull(),
    audio: bytea('audio'),
    audioContentType: varchar({ length: 80 }),
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
