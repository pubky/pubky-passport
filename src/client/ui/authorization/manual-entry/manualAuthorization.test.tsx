/** @vitest-environment jsdom */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { enterAuthorization } from "../../../browser/authorization/browserManualAuthorization";
import { ManualAuthorization } from "./manualAuthorization";

const qr = vi.hoisted(() => ({
  decode: undefined as undefined | ((result: { data: string; cornerPoints: never[] }) => void),
  destroy: vi.fn(),
  hasCamera: vi.fn(async () => true),
  start: vi.fn(async () => undefined),
}));

vi.mock("../../../browser/authorization/browserManualAuthorization", () => ({
  enterAuthorization: vi.fn(() => "navigating"),
}));

vi.mock("qr-scanner", () => ({
  default: class MockQrScanner {
    static hasCamera = qr.hasCamera;

    constructor(_video: HTMLVideoElement, decode: typeof qr.decode) {
      qr.decode = decode;
    }

    destroy = qr.destroy;
    start = qr.start;
  },
}));

describe("ManualAuthorization", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    qr.decode = undefined;
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

  it("submits through the existing validated browser entry", async () => {
    const user = userEvent.setup();
    render(<ManualAuthorization onBack={vi.fn()} />);
    const request = "pubkyauth://signin?request=test";

    await user.type(screen.getByLabelText("Authorization link"), request);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(enterAuthorization).toHaveBeenCalledWith(request);
  });

  it("fills the authorization input from a camera scan and stops the camera", async () => {
    const user = userEvent.setup();
    render(<ManualAuthorization onBack={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Scan QR" }));
    expect(screen.getByRole("dialog", { name: "Scan authorization QR" })).toBeInTheDocument();
    await waitFor(() => expect(qr.start).toHaveBeenCalledOnce());

    act(() => qr.decode?.({ data: "pubkyauth://signin?request=scanned", cornerPoints: [] }));

    expect(screen.getByLabelText("Authorization link")).toHaveValue("pubkyauth://signin?request=scanned");
    expect(screen.queryByRole("dialog", { name: "Scan authorization QR" })).not.toBeInTheDocument();
    expect(qr.destroy).toHaveBeenCalledOnce();
  });
});
