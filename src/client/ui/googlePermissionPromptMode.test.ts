import { describe, expect, it } from "vitest";

import { googlePermissionPromptMode } from "./googlePermissionPromptMode";

describe("googlePermissionPromptMode", () => {
  it.each([
    ["google_drive_access_required", "establish", "required"],
    ["google_drive_access_required", "backup", "required"],
    ["google_drive_access_required", "detach", "detach"],
    ["visible_backup_permission_missing", "establish", "optional"],
    ["visible_backup_permission_missing", "backup", "optional"],
    ["visible_backup_permission_missing", "detach", undefined],
    ["google_authorization_denied", "establish", undefined],
    ["google_authorization_denied", "backup", "required"],
    ["google_authorization_denied", "detach", "detach"],
    ["google_detachment_permission_required", "establish", undefined],
    ["google_detachment_permission_required", "backup", undefined],
    ["google_detachment_permission_required", "detach", "detach"],
    ["google_backup_conflict", "backup", undefined],
    ["authorization_failed", "detach", undefined],
  ] as const)("maps %s during %s to %s", (code, operation, mode) => {
    expect(googlePermissionPromptMode(code, operation)).toBe(mode);
  });
});
