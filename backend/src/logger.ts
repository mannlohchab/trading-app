// Minimal structured logger: one JSON object per line on stdout/stderr.
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, message: string, fields?: Record<string, unknown>) => void;

export function createLogger(scope: string, sink: (line: string, level: LogLevel) => void = defaultSink): Logger {
  return (level, message, fields = {}) => {
    sink(JSON.stringify({ time: new Date().toISOString(), level, scope, message, ...fields }), level);
  };
}

const defaultSink = (line: string, level: LogLevel) => (level === 'error' || level === 'warn' ? console.error(line) : console.log(line));

export const silentLogger: Logger = () => {};
