export function getSwipeOffset(distance: number, travel: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(travel) || travel <= 0) return 0;
  return Math.min(travel, Math.max(0, distance));
}

export function isSwipeComplete(distance: number, travel: number): boolean {
  return travel > 0 && Number.isFinite(travel) && Number.isFinite(distance)
    && getSwipeOffset(distance, travel) >= travel * 0.9;
}
