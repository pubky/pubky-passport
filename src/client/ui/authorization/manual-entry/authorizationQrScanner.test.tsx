/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "../../../../libs/logger/logger";
import { AuthorizationQrScanner } from "./authorizationQrScanner";

type ScannerControls = { stop: ReturnType<typeof vi.fn> };
type ScanCallback = (
  result: { getText: () => string } | undefined,
  error: undefined,
  controls: ScannerControls,
) => void;

const MOCKS = vi.hoisted(() => ({
  decodeFromConstraints: vi.fn(),
}));

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class BrowserQRCodeReader {
    decodeFromConstraints(...args: unknown[]) {
      return MOCKS.decodeFromConstraints(...args);
    }
  },
}));

describe("AuthorizationQrScanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("prefers the rear camera, scans once, and stops the camera", async () => {
    const controls: ScannerControls = { stop: vi.fn() };
    let callback: ScanCallback | undefined;
    MOCKS.decodeFromConstraints.mockImplementation(
      (
        _constraints: MediaStreamConstraints,
        _preview: HTMLVideoElement,
        nextCallback: ScanCallback,
      ) => {
        callback = nextCallback;
        return Promise.resolve(controls);
      },
    );
    const onScan = vi.fn();
    render(<AuthorizationQrScanner onClose={vi.fn()} onScan={onScan} />);

    await waitFor(() => expect(MOCKS.decodeFromConstraints).toHaveBeenCalledOnce());
    expect(MOCKS.decodeFromConstraints.mock.calls[0]?.[0]).toEqual({
      audio: false,
      video: { facingMode: { ideal: "environment" } },
    });
    await waitFor(() => expect(screen.queryByText("Starting camera…")).not.toBeInTheDocument());

    act(() => callback?.({ getText: () => "pubkyauth://signin?request" }, undefined, controls));

    expect(onScan).toHaveBeenCalledWith("pubkyauth://signin?request");
    expect(controls.stop).toHaveBeenCalledOnce();
    act(() => callback?.({ getText: () => "second-result" }, undefined, controls));
    expect(onScan).toHaveBeenCalledOnce();
  });

  it("shows a safe error when camera access is unavailable", async () => {
    const info = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    MOCKS.decodeFromConstraints.mockRejectedValue(
      new DOMException("SENSITIVE-CAMERA-DETAIL", "NotAllowedError"),
    );
    render(<AuthorizationQrScanner onClose={vi.fn()} onScan={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Camera access is unavailable. Allow camera access or paste the link instead.",
    );
    expect(info).toHaveBeenCalledWith("authorize.manual_entry.failed", {
      operation: "scan_qr",
      code: "camera_unavailable",
      diagnosticId: expect.any(String),
      errorName: "NotAllowedError",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("SENSITIVE-CAMERA-DETAIL");
  });

  it("stops an active camera when the scanner closes", async () => {
    const controls: ScannerControls = { stop: vi.fn() };
    MOCKS.decodeFromConstraints.mockResolvedValue(controls);
    const onClose = vi.fn();
    const user = userEvent.setup();
    const view = render(<AuthorizationQrScanner onClose={onClose} onScan={vi.fn()} />);

    await waitFor(() => expect(screen.queryByText("Starting camera…")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();

    view.unmount();
    expect(controls.stop).toHaveBeenCalledOnce();
  });
});
