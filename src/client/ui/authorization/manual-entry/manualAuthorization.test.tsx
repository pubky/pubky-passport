/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "@/libs/logger/logger";
import { ManualAuthorization } from "./manualAuthorization";

vi.mock("./authorizationQrScanner", () => ({
  AuthorizationQrScanner: ({
    onClose,
    onScan,
  }: {
    onClose: () => void;
    onScan: (value: string) => void;
  }) => (
    <div aria-label="Authorization QR scanner" role="dialog">
      <button onClick={() => onScan(VALID_REQUEST)} type="button">
        Scan valid QR
      </button>
      <button onClick={() => onScan("not-an-authorization-request")} type="button">
        Scan invalid QR
      </button>
      <button onClick={onClose} type="button">
        Close scanner
      </button>
    </div>
  ),
}));

const VALID_REQUEST =
  "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8";

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
    const readText = vi
      .spyOn(navigator.clipboard, "readText")
      .mockResolvedValue(
        "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https%3A%2F%2Frelay.example%2Finbox&secret=test",
      );
    render(<ManualAuthorization onBack={vi.fn()} />);

    const input = screen.getByLabelText("Authorization link");
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "pubkyauth://");
    expect(input.parentElement).toHaveClass("h-14", "md:h-15");
    expect(screen.getByText("Authorization link")).toHaveClass("leading-5", "md:leading-4");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    const scanButton = screen.getByRole("button", { name: "Scan QR" });
    expect(scanButton).toBeEnabled();
    expect(scanButton).toHaveClass("w-full", "md:hidden");
    const cameraButton = screen.getByRole("button", { name: "Scan authorization QR code" });
    expect(cameraButton).toHaveClass("hidden", "md:inline-flex");
    const cameraIcon = cameraButton.querySelector("svg");
    expect(cameraIcon).toHaveAttribute("viewBox", "0 0 21.5 17.5");
    expect(cameraIcon).toHaveStyle({ width: "20px", height: "20px" });
    expect(cameraIcon?.parentElement).toHaveClass("size-5", "items-center", "justify-center");
    expect(screen.getByRole("button", { name: "Paste authorization link" })).toHaveClass(
      "size-6",
      "md:size-8",
    );
    const back = screen.getByRole("button", { name: "Back" });
    const navigation = back.parentElement?.parentElement;
    expect(navigation).toHaveClass("mt-auto", "md:mt-0", "md:pt-6");
    expect(
      back.compareDocumentPosition(scanButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      scanButton.compareDocumentPosition(screen.getByRole("button", { name: "Continue" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Paste authorization link" }));

    expect(readText).toHaveBeenCalledOnce();
    expect((input as HTMLInputElement).value).toContain("pubkyauth://signin");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("opens the camera scanner and accepts a valid authorization QR code", async () => {
    const user = userEvent.setup();
    render(<ManualAuthorization onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Scan QR" }));
    expect(screen.getByRole("dialog", { name: "Authorization QR scanner" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Scan valid QR" }));

    expect(
      screen.queryByRole("dialog", { name: "Authorization QR scanner" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Authorization link")).toHaveValue(VALID_REQUEST);
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("rejects a QR code that does not contain an authorization request", async () => {
    const user = userEvent.setup();
    render(<ManualAuthorization onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Scan QR" }));
    await user.click(screen.getByRole("button", { name: "Scan invalid QR" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Scan a QR code containing a valid pubkyauth:// authorization link.",
    );
    expect(screen.getByLabelText("Authorization link")).toHaveValue("");
  });

  it("submits through the validated authorization entry", async () => {
    const user = userEvent.setup();
    render(<ManualAuthorization onBack={vi.fn()} />);
    await user.type(screen.getByLabelText("Authorization link"), VALID_REQUEST);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByLabelText("Authorization link")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(window.location.pathname).toBe("/authorize");
    expect(
      decodeURIComponent(new URLSearchParams(window.location.hash.slice(1)).get("d") ?? ""),
    ).toBe(VALID_REQUEST);
  });

  it("shows a validation error", async () => {
    render(<ManualAuthorization onBack={vi.fn()} />);

    await userEvent.setup().type(screen.getByLabelText("Authorization link"), "invalid request");
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a valid pubkyauth:// authorization link.",
    );
    expect(screen.getByLabelText("Authorization link")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Authorization link")).toHaveValue("");
  });

  it("shows and safely logs a browser navigation failure", async () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    vi.spyOn(History.prototype, "replaceState").mockImplementationOnce(() => {
      throw new Error("secret-canary");
    });
    render(<ManualAuthorization onBack={vi.fn()} />);

    await userEvent.setup().type(screen.getByLabelText("Authorization link"), VALID_REQUEST);
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not open the authorization request. Try again.",
    );
    expect(screen.getByLabelText("Authorization link")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Authorization link")).toHaveValue("");
    expect(info).toHaveBeenCalledWith("authorize.manual_entry.failed", {
      operation: "enter_authorization",
      code: "navigation_failed",
      diagnosticId: expect.any(String),
      errorName: "Error",
    });
    expect(info).toHaveBeenCalledOnce();
    expect(JSON.stringify(info.mock.calls)).not.toContain("secret-canary");
  });

  it("shows and safely logs a clipboard failure", async () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    vi.spyOn(navigator.clipboard, "readText").mockRejectedValueOnce(
      new DOMException("SECRET-CLIPBOARD-CANARY", "NotAllowedError"),
    );
    render(<ManualAuthorization onBack={vi.fn()} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Paste authorization link" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Clipboard access was blocked. Paste the link manually.",
    );
    expect(info).toHaveBeenCalledWith("authorize.manual_entry.failed", {
      operation: "read_clipboard",
      code: "clipboard_unavailable",
      diagnosticId: expect.any(String),
      errorName: "NotAllowedError",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("SECRET-CLIPBOARD-CANARY");
  });
});
