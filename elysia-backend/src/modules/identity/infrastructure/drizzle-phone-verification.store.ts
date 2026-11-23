import { and, desc, eq, gte, isNull, or } from 'drizzle-orm';
import type { AppDatabase } from '../../../db/types';
import { phoneVerifications } from '../../../db/schema';
import type { PhoneVerificationStore } from '../application/ports';

export class DrizzlePhoneVerificationStore implements PhoneVerificationStore {
  constructor(private readonly db: AppDatabase) {}

  async recentSendTimes(phoneNumber: string, userId: string, since: Date) {
    const rows = await this.db
      .select({ createdAt: phoneVerifications.createdAt })
      .from(phoneVerifications)
      .where(and(
        or(eq(phoneVerifications.phoneNumber, phoneNumber), eq(phoneVerifications.userId, userId)),
        gte(phoneVerifications.createdAt, since),
      ));
    return rows.map(r => r.createdAt);
  }

  async createChallenge(input: Parameters<PhoneVerificationStore['createChallenge']>[0]) {
    await this.db.transaction(async tx => {
      await tx
        .update(phoneVerifications)
        .set({ consumedAt: input.createdAt })
        .where(and(
          eq(phoneVerifications.userId, input.userId),
          eq(phoneVerifications.phoneNumber, input.phoneNumber),
          isNull(phoneVerifications.consumedAt),
        ));
      await tx.insert(phoneVerifications).values(input);
    });
  }

  async attempt(userId: string, phoneNumber: string, decide: Parameters<PhoneVerificationStore['attempt']>[2]) {
    return this.db.transaction(async tx => {
      // Row lock: concurrent guesses against the same challenge are serialized, so attempts can't be raced.
      const [row] = await tx
        .select()
        .from(phoneVerifications)
        .where(and(
          eq(phoneVerifications.userId, userId),
          eq(phoneVerifications.phoneNumber, phoneNumber),
          isNull(phoneVerifications.consumedAt),
        ))
        .orderBy(desc(phoneVerifications.createdAt))
        .limit(1)
        .for('update');
      const decision = decide(row ?? null);
      if (row && decision.change) {
        await tx.update(phoneVerifications).set(decision.change).where(eq(phoneVerifications.id, row.id));
      }
      return decision;
    });
  }
}
