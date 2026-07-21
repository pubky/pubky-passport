import { Result, type Err, type Result as ResultType } from "better-result";

/**
 * The supported v1 request grammar. Parsing and URL validation share these names
 * so a request cannot be reviewed under a different parameter interpretation.
 */
export const pubkyAuthRequestParameters = {
  relay: "relay",
  secret: "secret",
  capabilities: "caps",
  source: "x-source",
  success: "x-success",
  error: "x-error",
  cancel: "x-cancel",
} as const;

export type PubkyAuthRequestParameterErrorCode = "duplicate_parameter" | "unsupported_parameter";

export type PubkyAuthRequestParameterError = {
  code: PubkyAuthRequestParameterErrorCode;
  message: string;
};

const supportedParameters = new Set<string>(Object.values(pubkyAuthRequestParameters));

export function validatePubkyAuthRequestParameters(
  searchParams: URLSearchParams,
): ResultType<void, PubkyAuthRequestParameterError> {
  const seen = new Set<string>();

  for (const [name] of searchParams) {
    if (!supportedParameters.has(name)) {
      return error("unsupported_parameter", "Pubky auth request contains an unsupported parameter.");
    }

    if (seen.has(name)) {
      return error("duplicate_parameter", "Pubky auth request contains a duplicate parameter.");
    }

    seen.add(name);
  }

  return Result.ok();
}

function error(
  code: PubkyAuthRequestParameterErrorCode,
  message: string,
): Err<never, PubkyAuthRequestParameterError> {
  return Result.err<never, PubkyAuthRequestParameterError>({ code, message });
}
