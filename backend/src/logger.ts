// Minimal structured logger: one JSON object per line on stdout/stderr.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, message: string, fields?: Record<string, unknown>) => void;

export type LogEvent = { scope: string; level: LogLevel; message: string; fields: Record<string, unknown> };
export type LogObserver = (event: LogEvent) => void;

const observers = new Set<LogObserver>();

/** Subscribes to every structured log event (e.g. to derive metrics). Returns an unsubscribe function. */
export function observeLogs(observer: LogObserver): () => void {
  observers.add(observer);
  return () => observers.delete(observer);
}

export function createLogger(scope: string, sink: (line: string, level: LogLevel) => void = defaultSink): Logger {
  return (level, message, fields = {}) => {
    for (const observer of observers) {
      try { observer({ scope, level, message, fields }); } catch { /* An observer must never break logging. */ }
    }
    sink(JSON.stringify({ time: new Date().toISOString(), level, scope, message, ...fields }), level);
  };
}

const defaultSink = (line: string, level: LogLevel) => (level === 'error' || level === 'warn' ? console.error(line) : console.log(line));

export const silentLogger: Logger = () => {};
