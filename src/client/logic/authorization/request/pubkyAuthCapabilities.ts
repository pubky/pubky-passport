import "client-only";

import { Result, type Err, type Result as ResultType } from "better-result";

import { PUBKY_AUTH_REQUEST_LIMITS } from "./pubkyAuthRequestLimits";

export type PubkyAuthCapability = {
  path: string;
  read: boolean;
  write: boolean;
};

export type PubkyAuthCapabilitiesParseErrorCode =
  | "missing_capabilities"
  | "too_many_capabilities"
  | "capability_too_long"
  | "empty_capability"
  | "invalid_capability_path"
  | "unsupported_capability_actions";

export type PubkyAuthCapabilitiesParseError = {
  code: PubkyAuthCapabilitiesParseErrorCode;
};

export type PubkyAuthCapabilitiesParseResult = ResultType<PubkyAuthCapability[], PubkyAuthCapabilitiesParseError>;

/** Parses the bounded Pubky capability list used for authorization review. */
export function parsePubkyAuthCapabilities(input: string | null | undefined): PubkyAuthCapabilitiesParseResult {
  if (input === null || input === undefined) {
    return error("missing_capabilities");
  }

  if (input.length === 0) return Result.ok([]);

  const rawCapabilities = input.split(",").map((capability) => capability.normalize("NFC"));
  if (rawCapabilities.length > PUBKY_AUTH_REQUEST_LIMITS.maximumCapabilityCount) {
    return error("too_many_capabilities");
  }

  if (rawCapabilities.some((capability) => capability.length === 0)) {
    return error("empty_capability");
  }

  if (rawCapabilities.some((capability) => capability.length > PUBKY_AUTH_REQUEST_LIMITS.maximumCapabilityCodeUnits)) {
    return error("capability_too_long");
  }

  const capabilities: PubkyAuthCapability[] = [];
  for (const rawCapability of rawCapabilities) {
    const capability = parseCapability(rawCapability);
    if (Result.isError(capability)) {
      return Result.err(capability.error);
    }

    capabilities.push(capability.value);
  }

  return Result.ok(capabilities);
}

type CapabilityParseResult = ResultType<PubkyAuthCapability, PubkyAuthCapabilitiesParseError>;

function parseCapability(input: string): CapabilityParseResult {
  const actionsStart = input.indexOf(":");
  if (actionsStart <= 0) {
    return error("invalid_capability_path");
  }

  const path = input.slice(0, actionsStart);
  const actions = input.slice(actionsStart + 1);
  if (utf8Length(path) > PUBKY_AUTH_REQUEST_LIMITS.maximumCapabilityPathUtf8Bytes) {
    return error("capability_too_long");
  }

  if (!isValidCapabilityPath(path)) {
    return error("invalid_capability_path");
  }

  if (!isValidCapabilityActions(actions)) {
    return error("unsupported_capability_actions");
  }

  return Result.ok({
    path,
    read: actions.includes("r"),
    write: actions.includes("w"),
  });
}

function isValidCapabilityPath(path: string): boolean {
  if (!path.startsWith("/") || /[:,]/u.test(path)) {
    return false;
  }
  if (/[\p{Bidi_Control}\p{Default_Ignorable_Code_Point}]/u.test(path)) {
    return false;
  }
  if (path === "/") return true;
  if (/\s$/u.test(path)) return false;

  const segments = path.slice(1).split("/");
  return segments.every((segment, index) => {
    if (segment.length === 0) return index === segments.length - 1;
    if (segment === "." || segment === "..") return false;
    if (utf8Length(segment) > 255 || segment.includes("\\")) return false;
    return ![...segment].some((character) => isControlCharacter(character));
  });
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && (
    codePoint <= 0x1f ||
    (codePoint >= 0x7f && codePoint <= 0x9f)
  );
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isValidCapabilityActions(actions: string): boolean {
  return /^[rw]+$/.test(actions);
}

function error(
  code: PubkyAuthCapabilitiesParseErrorCode,
): Err<never, PubkyAuthCapabilitiesParseError> {
  return Result.err<never, PubkyAuthCapabilitiesParseError>({ code });
}
