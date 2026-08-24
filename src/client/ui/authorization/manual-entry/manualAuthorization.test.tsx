/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../../../libs/logger/logger";
import { validateManualAuthorizationInput } from "../../../logic/authorization/entry/manualAuthorizationInput";
import { ManualAuthorization } from "./manualAuthorization";

vi.mock("../../../logic/authorization/entry/manualAuthorizationInput", () => ({
  validateManualAuthorizationInput: vi.fn(() => ({
    status: "valid",
    destination: "/authorize#d=encoded-request",
  })),
}));

describe("ManualAuthorization", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState({}, "", "/");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts with an empty input and pastes from the clipboard", async () => {
    const user = userEvent.setup();
    const readText = vi.spyOn(navigator.clipboard, "readText").mockResolvedValue("pubkyauth://signin?caps=/pub/example.app/:rw&relay=https%3A%2F%2Frelay.example%2Finbox&secret=test");
    render(<ManualAuthorization onBack={vi.fn()} />);

    const input = screen.getByLabelText("Authorization link");
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "pubkyauth://");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Paste authorization link" }));

    expect(readText).toHaveBeenCalledOnce();
    expect((input as HTMLInputElement).value).toContain("pubkyauth://signin");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("submits through the validated authorization entry", async () => {
    const user = userEvent.setup();
    render(<ManualAuthorization onBack={vi.fn()} />);
    const request = "pubkyauth://signin?request=test";

    await user.type(screen.getByLabelText("Authorization link"), request);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(validateManualAuthorizationInput).toHaveBeenCalledWith(request);
    expect(screen.getByLabelText("Authorization link")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(window.location.pathname).toBe("/authorize");
    expect(new URLSearchParams(window.location.hash.slice(1)).get("d")).toBe("encoded-request");
  });

  it("shows a validation error", async () => {
    vi.mocked(validateManualAuthorizationInput).mockReturnValueOnce({ status: "invalid" });
    render(<ManualAuthorization onBack={vi.fn()} />);

    await userEvent.setup().type(screen.getByLabelText("Authorization link"), "invalid request");
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid pubkyauth:// authorization link.");
    expect(screen.getByLabelText("Authorization link")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Authorization link")).toHaveValue("");
  });

  it("shows and safely logs a browser navigation failure", async () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    vi.spyOn(History.prototype, "replaceState").mockImplementationOnce(() => {
      throw new Error("secret-canary");
    });
    render(<ManualAuthorization onBack={vi.fn()} />);

    await userEvent.setup().type(screen.getByLabelText("Authorization link"), "valid request");
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Could not open the authorization request. Try again.");
    expect(screen.getByLabelText("Authorization link")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Authorization link")).toHaveValue("");
    expect(info).toHaveBeenCalledWith("authorize.manual_entry.failed", {
      operation: "enter_authorization",
      code: "navigation_failed",
    });
    expect(info).toHaveBeenCalledOnce();
    expect(JSON.stringify(info.mock.calls)).not.toContain("secret-canary");
  });
});
