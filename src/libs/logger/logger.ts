import { redactForLog } from "../security/redaction";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFieldValue = string | number | boolean | null | undefined;

export type LogFields = Record<string, LogFieldValue>;

export type LogSink = Record<LogLevel, (message: string) => void>;

export type Logger = Record<LogLevel, (event: string, fields?: LogFields) => void>;

const consoleSink: LogSink = {
  debug(message) {
    console.debug(message);
  },
  info(message) {
    console.info(message);
  },
  warn(message) {
    console.warn(message);
  },
  error(message) {
    console.error(message);
  },
};

export function createLogger(sink: LogSink = consoleSink): Logger {
  return {
    debug(event, fields) {
      writeLog(sink, "debug", event, fields);
    },
    info(event, fields) {
      writeLog(sink, "info", event, fields);
    },
    warn(event, fields) {
      writeLog(sink, "warn", event, fields);
    },
    error(event, fields) {
      writeLog(sink, "error", event, fields);
    },
  };
}

export const logger = createLogger();

function writeLog(sink: LogSink, level: LogLevel, event: string, fields: LogFields | undefined): void {
  sink[level](redactForLog(formatLogLine(level, event, fields)));
}

function formatLogLine(level: LogLevel, event: string, fields: LogFields | undefined): string {
  const parts = [`level=${level}`, `event=${formatLogValue(event)}`];

  for (const [key, value] of Object.entries(fields ?? {})) {
    if (value === undefined) {
      continue;
    }

    parts.push(`${formatLogFieldKey(key)}=${formatLogValue(value)}`);
  }

  return parts.join(" ");
}

function formatLogFieldKey(key: string): string {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(key) ? key : JSON.stringify(key);
}

function formatLogValue(value: Exclude<LogFieldValue, undefined>): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  return String(value);
}
