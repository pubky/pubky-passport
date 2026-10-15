import { describe, expect, it } from "vitest";

import {
  isCanonicalPubkyAuthEncryptionPublicKey,
  isCanonicalPubkyAuthSecret,
} from "./pubkyProtocol";

describe("32-byte Pubky Auth transport encodings", () => {
  it.each([
    ["shared secret", isCanonicalPubkyAuthSecret],
    ["HPKE recipient public key", isCanonicalPubkyAuthEncryptionPublicKey],
  ])("requires canonical unpadded base64url for the %s", (_name, validate) => {
    expect(validate("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(true);
    expect(validate("kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8")).toBe(true);
    expect(validate("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB")).toBe(false);
    expect(validate("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")).toBe(false);
    expect(validate("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+")).toBe(false);
    expect(validate("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/")).toBe(false);
    expect(validate("A".repeat(42))).toBe(false);
    expect(validate("A".repeat(44))).toBe(false);
    expect(validate("")).toBe(false);
  });
});
