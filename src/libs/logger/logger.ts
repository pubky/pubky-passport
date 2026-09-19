import { redactForLog } from "./redaction";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogFieldValue = string | number | boolean | null | undefined;

export type LogFields = Record<string, LogFieldValue>;

export type Logger = Record<LogLevel, (event: string, fields?: LogFields) => void>;

const CONSOLE_SINK: Record<LogLevel, (message: string) => void> = {
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

export const LOGGER: Logger = {
  debug(event, fields) {
    writeLog("debug", event, fields);
  },
  info(event, fields) {
    writeLog("info", event, fields);
  },
  warn(event, fields) {
    writeLog("warn", event, fields);
  },
  error(event, fields) {
    writeLog("error", event, fields);
  },
};

const ERROR_DIAGNOSTIC_IDS = new WeakMap<object, string>();
let nextFallbackDiagnosticId = 0;

const SAFE_ERROR_NAMES: ReadonlySet<string> = new Set([
  "AbortError",
  "AggregateError",
  "CompileError",
  "ConstraintError",
  "DataCloneError",
  "DataError",
  "EncodingError",
  "Error",
  "EvalError",
  "HierarchyRequestError",
  "HttpResponseError",
  "IndexSizeError",
  "InvalidAccessError",
  "InvalidCharacterError",
  "InvalidModificationError",
  "InvalidNodeTypeError",
  "InvalidStateError",
  "InUseAttributeError",
  "LinkError",
  "NamespaceError",
  "NetworkError",
  "NoModificationAllowedError",
  "NotAllowedError",
  "NotFoundError",
  "NotReadableError",
  "NotSupportedError",
  "OperationError",
  "QuotaExceededError",
  "RangeError",
  "ReadOnlyError",
  "ReferenceError",
  "RuntimeError",
  "SecurityError",
  "SuppressedError",
  "SyntaxError",
  "TimeoutError",
  "TransactionInactiveError",
  "TypeError",
  "TypeMismatchError",
  "URIError",
  "URLMismatchError",
  "UnknownError",
  "VersionError",
  "WrongDocumentError",
]);

/**
 * Returns correlation metadata that is safe to log for an arbitrary thrown value.
 * Messages and stacks are omitted because exception text is untrusted and may
 * echo sensitive inputs; stacks also commonly repeat the message.
 */
export function safeErrorLogFields(error: unknown): LogFields {
  const target = diagnosticTarget(error);
  return {
    diagnosticId: diagnosticId(target),
    errorName: safeErrorName(target),
  };
}

function writeLog(level: LogLevel, event: string, fields: LogFields | undefined): void {
  try {
    CONSOLE_SINK[level](redactForLog(formatLogLine(level, event, fields)));
  } catch {
    // Logging must never alter the application flow it is observing.
  }
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

function diagnosticTarget(error: unknown): unknown {
  let current = error;
  const visited = new Set<object>();
  for (let depth = 0; depth < 8 && isObject(current) && !visited.has(current); depth += 1) {
    visited.add(current);
    try {
      if (!("cause" in current) || current.cause === undefined) break;
      current = current.cause;
    } catch {
      break;
    }
  }
  return current;
}

function diagnosticId(error: unknown): string {
  if (isObject(error)) {
    const existing = ERROR_DIAGNOSTIC_IDS.get(error);
    if (existing) return existing;
    const created = createDiagnosticId();
    ERROR_DIAGNOSTIC_IDS.set(error, created);
    return created;
  }
  return createDiagnosticId();
}

function createDiagnosticId(): string {
  try {
    const randomUuid = globalThis.crypto?.randomUUID;
    if (typeof randomUuid === "function") return randomUuid.call(globalThis.crypto);
  } catch {
    // Fall back to a process-local identifier below.
  }
  nextFallbackDiagnosticId += 1;
  return `error-${Date.now().toString(36)}-${nextFallbackDiagnosticId.toString(36)}`;
}

function safeErrorName(error: unknown): string {
  if (!isObject(error)) return typeof error;
  try {
    const name = "name" in error ? error.name : undefined;
    return typeof name === "string" && SAFE_ERROR_NAMES.has(name) ? name : "ErrorLike";
  } catch {
    return "ErrorLike";
  }
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}
