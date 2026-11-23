import { sql, type SQL } from 'drizzle-orm';
import { check, customType, index, pgTable, text, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, jsonObject, timestamptz, updatedAt } from '../columns';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/**
 * Crypto news from every configured source, de-duplicated by canonical URL (the same story from an
 * aggregator and from the publisher's feed is one row; `providers` lists who delivered it).
 */
export const newsArticles = pgTable(
  'news_articles',
  {
    id: id(),
    canonicalUrl: varchar({ length: 2048 }).notNull(),
    url: varchar({ length: 2048 }).notNull(),
    title: varchar({ length: 500 }).notNull(),
    summary: text(),
    imageUrl: varchar({ length: 2048 }),
    author: varchar({ length: 200 }),
    publisher: varchar({ length: 100 }).notNull(),
    publisherKey: varchar({ length: 50 }).notNull(),
    publishedAt: timestamptz().notNull(),
    /** Set the first time an aggregator flags the story as breaking. */
    breakingAt: timestamptz(),
    categories: text().array().notNull().default(sql`'{}'::text[]`),
    /** Coin codes the story is about, e.g. {BTC,ETH}. */
    assets: text().array().notNull().default(sql`'{}'::text[]`),
    /** Source ids that delivered the story, e.g. {coindesk,cryptocurrency-cv}. */
    providers: text().array().notNull().default(sql`'{}'::text[]`),
    metadata: jsonObject(),
    search: tsvector().generatedAlwaysAs((): SQL => sql`to_tsvector('english', ${newsArticles.title} || ' ' || coalesce(${newsArticles.summary}, ''))`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    uniqueIndex('news_articles_canonical_url_uq').on(t.canonicalUrl),
    check('news_articles_url_http_chk', sql`${t.url} ~ '^https?://' AND (${t.imageUrl} IS NULL OR ${t.imageUrl} ~ '^https?://')`),
    index('news_articles_published_idx').on(t.publishedAt.desc(), t.id.desc()),
    index('news_articles_publisher_idx').on(t.publisherKey, t.publishedAt.desc()),
    index('news_articles_assets_idx').using('gin', t.assets),
    index('news_articles_search_idx').using('gin', t.search),
    index('news_articles_breaking_idx').on(t.breakingAt).where(sql`${t.breakingAt} IS NOT NULL`),
  ],
);

export type NewsArticleRow = typeof newsArticles.$inferSelect;
