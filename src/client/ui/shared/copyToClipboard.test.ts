import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "@/libs/logger/logger";
import { copyToClipboard, PUBKY_COPY_TOASTS } from "./copyToClipboard";

const MOCKS = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: MOCKS.toastError, success: MOCKS.toastSuccess } }));

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
    MOCKS.toastSuccess.mockReset();
    MOCKS.toastError.mockReset();
  });

  it("copies the value and confirms it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    await expect(copyToClipboard("value", TOASTS)).resolves.toBe(true);

    expect(writeText).toHaveBeenCalledWith("value");
    expect(MOCKS.toastSuccess).toHaveBeenCalledWith("Pubky copied to clipboard", {
      description: "short pubky",
    });
  });

  it("confirms a copied pubky with its start, cut at 28 characters to fit one line", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.resolve() } });
    const pubky = "pubky" + "o".repeat(30) + "end";

    await copyToClipboard(pubky, PUBKY_COPY_TOASTS);
    await copyToClipboard("p".repeat(29), PUBKY_COPY_TOASTS);
    await copyToClipboard("p".repeat(28), PUBKY_COPY_TOASTS);

    expect(MOCKS.toastSuccess.mock.calls).toEqual([
      ["Pubky copied to clipboard", { description: `pubky${"o".repeat(23)}…` }],
      ["Pubky copied to clipboard", { description: `${"p".repeat(28)}…` }],
      // A value no longer than the cut is shown whole, with no ellipsis.
      ["Pubky copied to clipboard", { description: "p".repeat(28) }],
    ]);
  });

  it("confirms without a description when none is given", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.resolve() } });

    await copyToClipboard("value", {
      copied: TOASTS.copied,
      failed: TOASTS.failed,
      failedDescription: TOASTS.failedDescription,
    });

    expect(MOCKS.toastSuccess.mock.calls).toEqual([["Pubky copied to clipboard"]]);
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
    expect(MOCKS.toastSuccess).not.toHaveBeenCalled();
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
    expect(MOCKS.toastSuccess).not.toHaveBeenCalled();
  });
});
