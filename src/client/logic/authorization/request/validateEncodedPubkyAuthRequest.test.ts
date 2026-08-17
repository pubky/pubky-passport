import { Result } from "better-result";
import { describe, expect, it } from "vitest";

import { validateEncodedPubkyAuthRequest } from "./validateEncodedPubkyAuthRequest";

const SECRET = "kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";
const VALID_REQUEST = `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=${SECRET}`;

describe("validateEncodedPubkyAuthRequest", () => {
  it("returns only success without exposing the parsed request", () => {
    const result = validateEncodedPubkyAuthRequest(encodeURIComponent(VALID_REQUEST));

    expect(Result.isOk(result)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("returns only a safe error code for invalid input", () => {
    const result = validateEncodedPubkyAuthRequest(encodeURIComponent(
      `pubkyauth://signin?secret=${SECRET}`,
    ));

    expect(Result.isError(result) && result.error).toEqual({ code: "missing_relay" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
