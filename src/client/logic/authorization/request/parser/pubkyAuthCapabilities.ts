import "client-only";

import { Result, type Result as ResultType } from "better-result";

import { isValidPubkyCapabilityPath, utf8Length } from "../../../pubky/pubkyProtocol";

/** Bounds enforced while parsing the requested capability list. */
export const PUBKY_AUTH_CAPABILITY_LIMITS = {
  maximumCapabilityCount: 64,
  maximumCapabilityCodeUnits: 1_024,
  // Mirrors @synonymdev/pubky 0.10 storage-path validation; adapter tests guard drift.
  maximumCapabilityPathUtf8Bytes: 972,
} as const;

export type PubkyAuthCapability = {
  path: string;
  read: boolean;
  write: boolean;
};

type PubkyAuthCapabilitiesParseErrorCode =
  | "too_many_capabilities"
  | "capability_too_long"
  | "empty_capability"
  | "invalid_capability_path"
  | "unsupported_capability_actions";

export type PubkyAuthCapabilitiesParseError = {
  code: PubkyAuthCapabilitiesParseErrorCode;
};

type PubkyAuthCapabilitiesParseResult = ResultType<
  PubkyAuthCapability[],
  PubkyAuthCapabilitiesParseError
>;

/** Parses the bounded Pubky capability list used for authorization review. */
export function parsePubkyAuthCapabilities(input: string): PubkyAuthCapabilitiesParseResult {
  if (input.length === 0) return Result.ok([]);

  const rawCapabilities = input.split(",").map((capability) => capability.normalize("NFC"));
  if (rawCapabilities.length > PUBKY_AUTH_CAPABILITY_LIMITS.maximumCapabilityCount) {
    return Result.err<never, PubkyAuthCapabilitiesParseError>({ code: "too_many_capabilities" });
  }

  if (rawCapabilities.some((capability) => capability.length === 0)) {
    return Result.err<never, PubkyAuthCapabilitiesParseError>({ code: "empty_capability" });
  }

  if (
    rawCapabilities.some(
      (capability) => capability.length > PUBKY_AUTH_CAPABILITY_LIMITS.maximumCapabilityCodeUnits,
    )
  ) {
    return Result.err<never, PubkyAuthCapabilitiesParseError>({ code: "capability_too_long" });
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
    return Result.err<never, PubkyAuthCapabilitiesParseError>({ code: "invalid_capability_path" });
  }

  const path = input.slice(0, actionsStart);
  const actions = input.slice(actionsStart + 1);
  if (utf8Length(path) > PUBKY_AUTH_CAPABILITY_LIMITS.maximumCapabilityPathUtf8Bytes) {
    return Result.err<never, PubkyAuthCapabilitiesParseError>({ code: "capability_too_long" });
  }

  if (!isValidPubkyCapabilityPath(path)) {
    return Result.err<never, PubkyAuthCapabilitiesParseError>({ code: "invalid_capability_path" });
  }

  if (!isValidCapabilityActions(actions)) {
    return Result.err<never, PubkyAuthCapabilitiesParseError>({
      code: "unsupported_capability_actions",
    });
  }

  return Result.ok({
    path,
    read: actions.includes("r"),
    write: actions.includes("w"),
  });
}

function isValidCapabilityActions(actions: string): boolean {
  return /^[rw]+$/.test(actions);
}
