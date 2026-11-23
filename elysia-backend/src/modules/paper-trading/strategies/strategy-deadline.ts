import { PaperError } from '../paper-trading.errors';

export const MAX_LIVE_DURATION_MINUTES = 365 * 24 * 60;
export type LiveScheduleInput = { endTime?: number; durationMinutes?: number; closePositionAtEnd?: boolean };

export function resolveLiveSchedule(input: LiveScheduleInput, now: number) {
  if (input.endTime !== undefined && input.durationMinutes !== undefined) throw new PaperError('VALIDATION_ERROR', 'Choose endTime or durationMinutes, not both.');
  if (input.durationMinutes !== undefined && (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1 || input.durationMinutes > MAX_LIVE_DURATION_MINUTES)) throw new PaperError('VALIDATION_ERROR', 'durationMinutes must be 1–525600.');
  const endTime = input.endTime ?? (input.durationMinutes === undefined ? undefined : now + input.durationMinutes * 60000);
  if (endTime !== undefined && (!Number.isSafeInteger(endTime) || endTime <= now || endTime > now + MAX_LIVE_DURATION_MINUTES * 60000)) throw new PaperError('VALIDATION_ERROR', 'The live test end must be in the future and at most 365 days away.');
  if (input.closePositionAtEnd && endTime === undefined) throw new PaperError('VALIDATION_ERROR', 'closePositionAtEnd requires a deadline.');
  return endTime === undefined ? {} : { endTime, closePositionAtEnd: input.closePositionAtEnd ?? false };
}

export function deadlineExpired(configuration: unknown, now: number) {
  const endTime = configuration && typeof configuration === 'object' ? (configuration as { endTime?: unknown }).endTime : undefined;
  return typeof endTime === 'number' && Number.isFinite(endTime) && endTime <= now;
}
