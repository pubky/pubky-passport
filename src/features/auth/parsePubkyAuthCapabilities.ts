import { Result, type Err, type Result as ResultType } from "better-result";

export type PubkyAuthCapabilityScope = "specific" | "broad";

export type PubkyAuthCapability = {
  path: string;
  read: boolean;
  write: boolean;
  scope: PubkyAuthCapabilityScope;
};

export type PubkyAuthCapabilitiesParseErrorCode =
  | "missing_capabilities"
  | "empty_capability"
  | "invalid_capability_path"
  | "unsupported_capability_actions";

export type PubkyAuthCapabilitiesParseError = {
  code: PubkyAuthCapabilitiesParseErrorCode;
  message: string;
};

export type PubkyAuthCapabilitiesParseResult = ResultType<PubkyAuthCapability[], PubkyAuthCapabilitiesParseError>;

export function parsePubkyAuthCapabilities(input: string | null | undefined): PubkyAuthCapabilitiesParseResult {
  if (input === null || input === undefined || input.trim().length === 0) {
    return error("missing_capabilities", "Pubky auth request is missing capabilities.");
  }

  const rawCapabilities = input.split(",");
  if (rawCapabilities.some((capability) => capability.length === 0)) {
    return error("empty_capability", "Pubky auth request contains an empty capability.");
  }

  const capabilities: PubkyAuthCapability[] = [];
  for (const rawCapability of rawCapabilities) {
    const capability = parseCapability(rawCapability);
    if (Result.isError(capability)) {
      return error(capability.error.code, capability.error.message);
    }

    capabilities.push(capability.value);
  }

  return Result.ok(capabilities);
}

type CapabilityParseResult = ResultType<PubkyAuthCapability, PubkyAuthCapabilitiesParseError>;

function parseCapability(input: string): CapabilityParseResult {
  const actionsStart = input.lastIndexOf(":");
  if (actionsStart <= 0) {
    return error("invalid_capability_path", "Pubky auth capability path is invalid.");
  }

  const path = input.slice(0, actionsStart);
  const actions = input.slice(actionsStart + 1);
  if (!isValidCapabilityPath(path)) {
    return error("invalid_capability_path", "Pubky auth capability path is invalid.");
  }

  if (!isValidCapabilityActions(actions)) {
    return error("unsupported_capability_actions", "Pubky auth capability actions are unsupported.");
  }

  return Result.ok({
      path,
      read: actions.includes("r"),
      write: actions.includes("w"),
      scope: getCapabilityScope(path),
  });
}

function isValidCapabilityPath(path: string): boolean {
  if (!path.startsWith("/")) {
    return false;
  }

  for (let index = 0; index < path.length; index += 1) {
    const char = path[index];
    if (!char || !isAllowedPathCharacter(char)) {
      return false;
    }

    if (char === "%") {
      if (!isHexDigit(path[index + 1]) || !isHexDigit(path[index + 2])) {
        return false;
      }

      index += 2;
    }
  }

  return true;
}

function isAllowedPathCharacter(char: string): boolean {
  return /^[A-Za-z0-9\-._~!$&'()*+,;=:@/%]$/.test(char);
}

function isHexDigit(char: string | undefined): boolean {
  return typeof char === "string" && /^[A-Fa-f0-9]$/.test(char);
}

function isValidCapabilityActions(actions: string): boolean {
  return /^[rw]+$/.test(actions);
}

function getCapabilityScope(path: string): PubkyAuthCapabilityScope {
  return path === "/" || path === "/pub" || path === "/pub/" ? "broad" : "specific";
}

function error(
  code: PubkyAuthCapabilitiesParseErrorCode,
  message: string,
): Err<never, PubkyAuthCapabilitiesParseError> {
  return Result.err<never, PubkyAuthCapabilitiesParseError>({ code, message });
}
