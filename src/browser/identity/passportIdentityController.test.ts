/** @vitest-environment jsdom */

import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import type { PassportIdentityControllerDependencies } from "./passportIdentityController";
import { PassportIdentityController } from "./passportIdentityController";

const CREDENTIALS = { googleIdToken: "id-token", driveAccessToken: "drive-token" };
const IDENTITY = { publicKeyZ32: "public-key", publicKeyDisplay: "pubkypublic-key" };

describe("PassportIdentityController", () => {
  it("prepares the single Google authorization flow", async () => {
    const states: unknown[] = [];
    const controller = new PassportIdentityController(dependencies());

    await controller.prepareGoogleAuthorization((state) => states.push(state));

    expect(states).toEqual([{ stage: "google-authorization", errorCode: null }]);
  });

  it("uses credentials returned by one authorization request", async () => {
    const states: unknown[] = [];
    const restore = vi.fn(async (_credentials, reportProgress) => {
      reportProgress("checking_passport_file");
      reportProgress("restoring_identity");
      return Result.ok({ establishmentMode: "restored" as const, publicIdentity: IDENTITY });
    });
    const controller = new PassportIdentityController(dependencies({ restoreOrCreateGoogleBackedIdentity: restore }));
    await controller.prepareGoogleAuthorization((state) => states.push(state));

    const completed = await controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" });

    expect(completed).toEqual({ status: "action_completed", result: Result.ok({ kind: "google_backed_identity_established", establishmentMode: "restored", publicIdentity: IDENTITY }) });
    expect(restore).toHaveBeenCalledWith(CREDENTIALS, expect.any(Function));
    expect(states).toContainEqual({ stage: "requesting-google-authorization" });
    expect(states).toContainEqual({ stage: "establishing-google-backed-identity", progress: "restoring_identity" });
  });

  it("maps popup failures back to a retryable authorization state", async () => {
    const states: unknown[] = [];
    const controller = new PassportIdentityController(dependencies({
      requestGoogleAuthorization: async () => Result.err({ code: "google_authorization_popup_closed" as const }),
    }));
    await controller.prepareGoogleAuthorization((state) => states.push(state));

    await expect(controller.continueGoogleBackedIdentityAction({ kind: "establish_google_backed_identity" })).resolves.toEqual({ status: "google_authorization_failed" });
    expect(states.at(-1)).toEqual({ stage: "google-authorization", errorCode: "google_drive_authorization_popup_closed" });
  });

  it("owns authorization and identity-operation disposal", () => {
    const disposeAuthorization = vi.fn();
    const disposeOperations = vi.fn();
    const controller = new PassportIdentityController(dependencies({ disposeGoogleAuthorization: disposeAuthorization, disposeGoogleBackedIdentityOperations: disposeOperations }));

    controller.dispose();
    controller.dispose();

    expect(disposeAuthorization).toHaveBeenCalledOnce();
    expect(disposeOperations).toHaveBeenCalledOnce();
  });

  it("contains local repository exceptions", () => {
    const controller = new PassportIdentityController(dependencies({ list: () => { throw new Error("storage failed"); } }));
    const result = controller.list();
    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "storage_unavailable" });
  });

  it("resolves the identity homeserver through PKDNS", async () => {
    const resolveHomeserver = vi.fn(async () => Result.ok("homeserver-pubky"));
    const controller = new PassportIdentityController(dependencies({ resolveHomeserver }));

    await expect(controller.resolveHomeserver("identity-pubky")).resolves.toEqual(Result.ok("homeserver-pubky"));
    expect(resolveHomeserver).toHaveBeenCalledWith("identity-pubky");
  });

  it("creates an encrypted local identity backup", async () => {
    const backup = Result.ok({ bytes: new Uint8Array([1, 2, 3]), fileName: "identity.pkarr" });
    const createBackup = vi.fn(async () => backup);
    const controller = new PassportIdentityController(dependencies({ createBackup }));

    await expect(controller.createBackup("identity", "strong password")).resolves.toBe(backup);
    expect(createBackup).toHaveBeenCalledWith("identity", "strong password");
  });

});

function dependencies(overrides: Partial<PassportIdentityControllerDependencies> = {}): PassportIdentityControllerDependencies {
  return {
    list: () => Result.ok({ activeIdentityId: null, identities: [] }),
    select: () => Result.ok(),
    remove: () => Result.ok(),
    clear: () => Result.ok(),
    subscribe: () => () => {},
    resolveHomeserver: async () => Result.ok(null),
    createBackup: async () => Result.err({ code: "backup_failed" as const }),
    prepareGoogleAuthorization: async () => Result.ok(),
    requestGoogleAuthorization: async () => Result.ok(CREDENTIALS),
    disposeGoogleAuthorization: () => {},
    restoreOrCreateGoogleBackedIdentity: async () => Result.err({ code: "unexpected_failure" as const }),
    deleteGoogleDrivePassportFile: async () => Result.ok({ status: "deleted" as const }),
    disposeGoogleBackedIdentityOperations: () => {},
    ...overrides,
  };
}
