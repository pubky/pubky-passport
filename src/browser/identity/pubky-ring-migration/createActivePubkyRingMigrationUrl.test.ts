import { Result } from "better-result";
import { describe, expect, it, vi } from "vitest";

import { createActivePubkyRingMigrationUrl } from "./createActivePubkyRingMigrationUrl";

describe("createActivePubkyRingMigrationUrl", () => {
  it("exports exactly the active identity in Pubky Ring's single-frame format", () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, index) => index);
    const readActive = vi.fn(() => Result.ok({
      identity: { id: "active", publicIdentity: { publicKeyZ32: "active", publicKeyDisplay: "pubkyactive" } },
      secretKey: { bytes, format: "pubky-secret-key" as const },
    }));

    const result = createActivePubkyRingMigrationUrl(readActive);

    expect(result).toEqual(Result.ok(
      "pubkyring://migrate?index=0&total=1&key=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    ));
    expect(readActive).toHaveBeenCalledOnce();
    expect(bytes).toEqual(new Uint8Array(32));
  });

  it("preserves an active-identity read failure", () => {
    const result = createActivePubkyRingMigrationUrl(() => Result.err({ code: "no_active_identity" }));

    expect(Result.isError(result)).toBe(true);
    if (Result.isError(result)) expect(result.error).toEqual({ code: "no_active_identity" });
  });
});
