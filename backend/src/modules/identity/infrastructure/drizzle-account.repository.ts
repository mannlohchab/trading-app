import { and, eq, ne } from 'drizzle-orm';
import type { AppDatabase } from '../../../db/types';
import { users } from '../../../db/schema';
import type { AccountRepository } from '../application/ports';

export class DrizzleAccountRepository implements AccountRepository {
  constructor(private readonly db: AppDatabase) {}

  async findAccount(userId: string) {
    const [row] = await this.db
      .select({ status: users.status, phoneNumberVerified: users.phoneNumberVerified })
      .from(users)
      .where(eq(users.id, userId));
    return row ?? null;
  }

  async isPhoneNumberTaken(phoneNumber: string, exceptUserId: string) {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.phoneNumber, phoneNumber), ne(users.id, exceptUserId)))
      .limit(1);
    return !!row;
  }

  async transitionStatus(userId: string, from: (typeof users.$inferSelect)['status'], to: (typeof users.$inferSelect)['status']) {
    const changed = await this.db
      .update(users)
      .set({ status: to })
      .where(and(eq(users.id, userId), eq(users.status, from)))
      .returning({ id: users.id });
    return changed.length > 0;
  }
}
