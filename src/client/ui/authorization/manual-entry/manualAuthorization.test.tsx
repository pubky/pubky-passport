/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { submitManualAuthorizationInput } from "../../../logic/authorization/entry/manualAuthorizationInput";
import { ManualAuthorization } from "./manualAuthorization";

vi.mock("../../../logic/authorization/entry/manualAuthorizationInput", () => ({
  submitManualAuthorizationInput: vi.fn(() => "navigating"),
}));

describe("ManualAuthorization", () => {
  afterEach(cleanup);

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

    expect(submitManualAuthorizationInput).toHaveBeenCalledWith(request);
    expect(screen.getByLabelText("Authorization link")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it.each([
    ["invalid", "Enter a valid pubkyauth:// authorization link."],
    ["navigation_failed", "Could not open the authorization request. Try again."],
  ] as const)("shows the %s submission error", async (result, message) => {
    vi.mocked(submitManualAuthorizationInput).mockReturnValueOnce(result);
    render(<ManualAuthorization onBack={vi.fn()} />);

    await userEvent.setup().type(screen.getByLabelText("Authorization link"), "invalid request");
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Authorization link")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Authorization link")).toHaveValue("");
  });
});
