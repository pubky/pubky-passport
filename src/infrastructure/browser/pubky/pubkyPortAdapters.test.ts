import { describe, expect, it } from "vitest";

import type { PubkyIdentityKeyHandle } from "../../../core/domain/identity/pubkyIdentity";
import {
  BrowserPubkyIdentityKeys,
  mapIdentityKeyErrorCode,
  mapIdentityOperationToAuthApprovalErrorCode,
  mapIdentityOperationToDiscoveryErrorCode,
  mapIdentityOperationToSignupErrorCode,
} from "./pubkyPortAdapters";

describe("browser Pubky port adapters", () => {
  it("maps key adapter errors to identity-key port errors", () => {
    expect(mapIdentityKeyErrorCode("keypair_creation_failed")).toBe("create_failed");
    expect(mapIdentityKeyErrorCode("secret_export_failed")).toBe("export_failed");
    expect(mapIdentityKeyErrorCode("secret_restore_failed")).toBe("restore_failed");
    expect(mapIdentityKeyErrorCode("invalid_secret_key")).toBe("invalid_secret_key");
    expect(mapIdentityKeyErrorCode("key_unavailable")).toBe("key_unavailable");
  });

  it("maps identity operation errors to signup port errors", () => {
    expect(mapIdentityOperationToSignupErrorCode("invalid_homeserver_pubky")).toBe("invalid_homeserver_pubky");
    expect(mapIdentityOperationToSignupErrorCode("key_unavailable")).toBe("key_unavailable");
    expect(mapIdentityOperationToSignupErrorCode("signin_failed")).toBe("signin_failed");
    expect(mapIdentityOperationToSignupErrorCode("signup_failed")).toBe("signup_failed");
    expect(mapIdentityOperationToSignupErrorCode("auth_approval_failed")).toBe("signup_failed");
    expect(mapIdentityOperationToSignupErrorCode("discovery_publish_failed")).toBe("signup_failed");
    expect(mapIdentityOperationToSignupErrorCode("invalid_pubky_auth_request")).toBe("signup_failed");
  });

  it("maps identity operation errors to discovery port errors", () => {
    expect(mapIdentityOperationToDiscoveryErrorCode("invalid_homeserver_pubky")).toBe("invalid_homeserver_pubky");
    expect(mapIdentityOperationToDiscoveryErrorCode("key_unavailable")).toBe("key_unavailable");
    expect(mapIdentityOperationToDiscoveryErrorCode("discovery_publish_failed")).toBe("publish_failed");
    expect(mapIdentityOperationToDiscoveryErrorCode("auth_approval_failed")).toBe("publish_failed");
    expect(mapIdentityOperationToDiscoveryErrorCode("invalid_pubky_auth_request")).toBe("publish_failed");
    expect(mapIdentityOperationToDiscoveryErrorCode("signin_failed")).toBe("publish_failed");
    expect(mapIdentityOperationToDiscoveryErrorCode("signup_failed")).toBe("publish_failed");
  });

  it("maps identity operation errors to auth-approval port errors", () => {
    expect(mapIdentityOperationToAuthApprovalErrorCode("key_unavailable")).toBe("key_unavailable");
    expect(mapIdentityOperationToAuthApprovalErrorCode("invalid_pubky_auth_request")).toBe("request_rejected");
    expect(mapIdentityOperationToAuthApprovalErrorCode("auth_approval_failed")).toBe("approval_failed");
    expect(mapIdentityOperationToAuthApprovalErrorCode("discovery_publish_failed")).toBe("approval_failed");
    expect(mapIdentityOperationToAuthApprovalErrorCode("invalid_homeserver_pubky")).toBe("approval_failed");
    expect(mapIdentityOperationToAuthApprovalErrorCode("signin_failed")).toBe("approval_failed");
    expect(mapIdentityOperationToAuthApprovalErrorCode("signup_failed")).toBe("approval_failed");
  });

  it("returns port-level key unavailable for unknown handles", async () => {
    const keys = new BrowserPubkyIdentityKeys();
    const unknownHandle = {} as PubkyIdentityKeyHandle;

    await expect(keys.getPublicIdentity({ keyHandle: unknownHandle })).resolves.toEqual({
      ok: false,
      error: { code: "key_unavailable" },
    });

    await expect(
      keys.exportSecretKey({ keyHandle: unknownHandle }),
    ).resolves.toEqual({
      ok: false,
      error: { code: "key_unavailable" },
    });
  });
});
