import { and, asc, eq } from 'drizzle-orm';
import { aiUserMemories } from '../../../db/schema';
import type { AppDatabase } from '../../../db/types';
import type { MemoryRepository } from '../application/ports';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const view = (r: typeof aiUserMemories.$inferSelect) => ({ id: r.id, content: r.content, createdAt: r.createdAt });

export class DrizzleMemoryRepository implements MemoryRepository {
  constructor(private readonly db: AppDatabase) {}

  async list(userId: string) {
    const rows = await this.db.select().from(aiUserMemories).where(eq(aiUserMemories.userId, userId)).orderBy(asc(aiUserMemories.createdAt), asc(aiUserMemories.id));
    return rows.map(view);
  }

  async add(userId: string, content: string) {
    const [row] = await this.db.insert(aiUserMemories).values({ userId, content }).returning();
    return view(row!);
  }

  async remove(userId: string, id: string) {
    if (!UUID.test(id)) return false;
    const rows = await this.db.delete(aiUserMemories).where(and(eq(aiUserMemories.id, id), eq(aiUserMemories.userId, userId))).returning({ id: aiUserMemories.id });
    return rows.length > 0;
  }

  async removeAll(userId: string) {
    const rows = await this.db.delete(aiUserMemories).where(eq(aiUserMemories.userId, userId)).returning({ id: aiUserMemories.id });
    return rows.length;
  }
}
