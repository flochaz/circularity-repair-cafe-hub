import { db } from '../db/index.js';
import { repairJobs } from '../db/schema.js';
import { and, eq, isNull, ne } from 'drizzle-orm';

/**
 * Whether another job in this session still has this card number out. A card
 * is handed back at the exit, not when the repair is marked finished, so the
 * number stays in use until card_returned_at is set. The unique index in
 * migration 0014 uses the same rule.
 *
 * Pass the job's own id when changing an existing job, so it does not clash
 * with itself.
 */
export async function cardInUse(eventId: string, cardNumber: number, exceptJobId?: string): Promise<boolean> {
  const conditions = [
    eq(repairJobs.eventId, eventId),
    eq(repairJobs.cardNumber, cardNumber),
    isNull(repairJobs.cardReturnedAt),
  ];
  if (exceptJobId) conditions.push(ne(repairJobs.id, exceptJobId));
  const clash = await db.select({ id: repairJobs.id }).from(repairJobs).where(and(...conditions)).limit(1);
  return clash.length > 0;
}

/** The reply when a card number is already taken. */
export function cardInUseError(cardNumber: number) {
  return {
    error: `Card ${cardNumber} is already with another visitor in this session. Choose a different number.`,
    code: 'checkin/card_in_use',
  };
}
