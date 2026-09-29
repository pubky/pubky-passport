import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "@/libs/logger/logger";
import { copyToClipboard } from "./copyToClipboard";

const MOCKS = vi.hoisted(() => ({ toastError: vi.fn(), toastInfo: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: MOCKS.toastError, info: MOCKS.toastInfo } }));

const TOASTS = {
  copied: "Pubky copied to clipboard",
  copiedDescription: "short pubky",
  failed: "Could not copy pubky",
  failedDescription: "Select and copy your pubky manually.",
};

describe("copyToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    MOCKS.toastInfo.mockReset();
    MOCKS.toastError.mockReset();
  });

  it("copies the value and confirms it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyToClipboard("value", TOASTS)).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("value");
    expect(MOCKS.toastInfo).toHaveBeenCalledWith("Pubky copied to clipboard", {
      description: "short pubky",
    });
  });

  it("confirms without a description when none is given", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.resolve() } });

    await copyToClipboard("value", {
      copied: TOASTS.copied,
      failed: TOASTS.failed,
      failedDescription: TOASTS.failedDescription,
    });

    expect(MOCKS.toastInfo.mock.calls).toEqual([["Pubky copied to clipboard"]]);
  });

  it("tells the user about a failed copy and logs it without the error message", async () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText: () => Promise.reject(new Error("SECRET-COPY-CANARY")) },
    });

    await expect(copyToClipboard("value", TOASTS)).resolves.toBe(false);

    // A failure is an error, not a confirmation look-alike, and stays until read or closed.
    expect(MOCKS.toastError).toHaveBeenCalledWith("Could not copy pubky", {
      closeButton: true,
      description: "Select and copy your pubky manually.",
      duration: 10_000,
    });
    expect(MOCKS.toastInfo).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      "clipboard.copy.failed",
      expect.objectContaining({ diagnosticId: expect.any(String), errorName: "Error" }),
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain("SECRET-COPY-CANARY");
  });

  it("treats a missing clipboard API as a failed copy", async () => {
    vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    vi.stubGlobal("navigator", {});

    await expect(copyToClipboard("value", TOASTS)).resolves.toBe(false);
    // A failure is an error, not a confirmation look-alike, and stays until read or closed.
    expect(MOCKS.toastError).toHaveBeenCalledWith("Could not copy pubky", {
      closeButton: true,
      description: "Select and copy your pubky manually.",
      duration: 10_000,
    });
    expect(MOCKS.toastInfo).not.toHaveBeenCalled();
  });
});
