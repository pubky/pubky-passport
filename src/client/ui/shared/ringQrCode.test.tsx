/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LOGGER } from "@/libs/logger/logger";
import { fitsRingQrCode, RING_QR_MAXIMUM_BYTES, RingQrCode } from "./ringQrCode";

const MOCKS = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { info: MOCKS.info, error: MOCKS.error } }));

const LINK = "pubkyauth://signin?caps=/pub/example.app/:rw&secret=link-secret-canary";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("RingQrCode", () => {
  it("shows the code on a light tile with Pubky Ring's mark over its centre, at level H", () => {
    const { container } = render(<RingQrCode label="Pubky authorization QR code" url={LINK} />);

    const tile = container.firstElementChild!;
    expect(tile).toHaveClass("size-48", "rounded-md", "bg-foreground", "p-2");
    expect(tile).toHaveAttribute("data-state", "ready");
    // The code keeps its own name: the press target lies over it, not around it.
    const code = screen.getByRole("img", { name: "Pubky authorization QR code" });
    expect(code.closest("button")).toBeNull();
    // Level H restores the covered centre: more modules than the same link at a lower level.
    const size = Number(code.getAttribute("viewBox")?.split(" ")[2]);
    expect(size).toBeGreaterThanOrEqual(45);
    const logo = container.querySelector('img[src="/brand/ring-logo.svg"]');
    expect(logo).toHaveAttribute("alt", "");
    expect(logo).toHaveAttribute("aria-hidden", "true");
    expect(logo).toHaveClass("left-1/2", "top-1/2", "pointer-events-none");
  });

  it("copies exactly the link it encodes when pressed, says so, and logs nothing of it", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const logged = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    render(<RingQrCode label="Pubky authorization QR code" url={LINK} />);

    await user.click(screen.getByRole("button", { name: "Copy authentication link" }));

    expect(writeText).toHaveBeenCalledExactlyOnceWith(LINK);
    expect(MOCKS.info).toHaveBeenCalledExactlyOnceWith("Authentication link copied");
    expect(MOCKS.error).not.toHaveBeenCalled();
    expect(JSON.stringify([logged.mock.calls, MOCKS.info.mock.calls])).not.toContain("canary");
  });

  it("fades the code and the Ring logo only while pressed, never on hover or after the click", () => {
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<RingQrCode label="Pubky authorization QR code" url={LINK} />);
    const code = screen.getByRole("img", { name: "Pubky authorization QR code" });
    const logo = code.parentElement!.querySelector("img")!;
    for (const part of [code, logo]) {
      expect(part).toHaveClass("group-active:opacity-80");
      expect(part.getAttribute("class")).not.toMatch(/hover:|opacity-70/);
    }
    fireEvent.click(screen.getByRole("button", { name: "Copy authentication link" }));
    // Released, it is fully dark again: no lighter step after the click.
    for (const part of [code, logo])
      expect(part.getAttribute("class")).not.toMatch(/(^| )opacity-/);
  });

  it("says when the link could not be copied, without logging the link", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    const logged = vi.spyOn(LOGGER, "info").mockImplementation(() => undefined);
    render(<RingQrCode label="Pubky authorization QR code" url={LINK} />);

    await user.click(screen.getByRole("button", { name: "Copy authentication link" }));

    expect(MOCKS.error).toHaveBeenCalledExactlyOnceWith(
      "Could not copy to clipboard",
      expect.objectContaining({ description: "Scan the code with Pubky Ring instead." }),
    );
    expect(JSON.stringify([logged.mock.calls, MOCKS.error.mock.calls])).not.toContain("canary");
  });

  it("offers no copy for a code whose link must stay out of the clipboard", () => {
    render(<RingQrCode copyLink={false} label="Pubky Ring migration QR code" url={LINK} />);

    expect(screen.getByRole("img", { name: "Pubky Ring migration QR code" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("keeps the tile's size while the code is prepared, and says it is generating", () => {
    const { container } = render(
      <RingQrCode label="Pubky authorization QR code" url={undefined} />,
    );

    expect(container.firstElementChild).toHaveClass("size-48");
    expect(container.firstElementChild).toHaveAttribute("data-state", "generating");
    expect(screen.getByRole("status")).toHaveTextContent("Generating QR code…");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("blurs an expired code, never drawing its link, and reloads on a press", async () => {
    const onReload = vi.fn();
    const { container } = render(
      <RingQrCode expired={{ onReload }} label="Pubky authorization QR code" url={LINK} />,
    );

    expect(container.firstElementChild).toHaveAttribute("data-state", "expired");
    expect(screen.getByText("Click to reload")).toBeInTheDocument();
    // The stand-in pattern is decoration: no code is named, and the link is not copyable.
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy authentication link" })).toBeNull();
    // Dark and inset like pubky.app's, not faded: only the blur says it is spent.
    expect(container.querySelector("svg")).toHaveClass("blur-[3px]", "p-2");
    expect(container.querySelector("svg")?.getAttribute("class")).not.toMatch(/(^| )opacity-/u);
    await userEvent.setup().click(screen.getByRole("button", { name: "Reload sign-in QR code" }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("knows which links fit a code at level H", () => {
    expect(fitsRingQrCode(LINK)).toBe(true);
    expect(fitsRingQrCode("a".repeat(RING_QR_MAXIMUM_BYTES))).toBe(true);
    expect(fitsRingQrCode("a".repeat(RING_QR_MAXIMUM_BYTES + 1))).toBe(false);
    // Bytes, not characters.
    expect(fitsRingQrCode("é".repeat(RING_QR_MAXIMUM_BYTES / 2 + 1))).toBe(false);
  });
});
