/** True when `error` (possibly wrapped by Drizzle) is a Postgres unique violation, optionally on `constraint`. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  for (let e: any = error; e; e = e.cause) {
    if (e.code === '23505') return !constraint || (e.constraint ?? e.constraint_name) === constraint;
  }
  return false;
}
