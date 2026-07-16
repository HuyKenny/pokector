/**
 * Structured JSON logging. Never log secrets, tokens, passwords, personal notes,
 * e-mail addresses, or full CSV payloads (see docs/SECURITY.md).
 */

type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  requestId?: string;
  environment?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  errorCode?: string;
  jobId?: string;
  [key: string]: string | number | boolean | null | undefined;
}

const REDACTED_KEY_PATTERN = /(secret|token|password|api[_-]?key|authorization|cookie)/i;

function sanitize(fields: LogFields): LogFields {
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    out[key] = REDACTED_KEY_PATTERN.test(key) ? "[redacted]" : value;
  }
  return out;
}

function emit(level: LogLevel, event: string, fields: LogFields): void {
  const line = JSON.stringify({
    level,
    event,
    time: new Date().toISOString(),
    ...sanitize(fields),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields: LogFields = {}) => emit("debug", event, fields),
  info: (event: string, fields: LogFields = {}) => emit("info", event, fields),
  warn: (event: string, fields: LogFields = {}) => emit("warn", event, fields),
  error: (event: string, fields: LogFields = {}) => emit("error", event, fields),
};
