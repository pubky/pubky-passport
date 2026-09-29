/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Keypair } from "@synonymdev/pubky";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import { PubkyRingMigration } from "@/client/logic/pubky/PubkySdkAdapter";
import { MigrateToPubkyRing } from "./migrateToPubkyRing";

const MIGRATION_URL =
  "pubkyring://000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

function createMigrationHandle(): PubkyRingMigration {
  return new PubkyRingMigration(
    Keypair.fromSecret(Uint8Array.from({ length: 32 }, (_, index) => index)),
  );
}

const QR_WARNING =
  "This code contains your private key. Anyone who scans it can use your pubky. Don’t show it on a shared or recorded screen.";

/** Stubs the desktop breakpoint; `change()` fires the listener the screen registered. */
function stubBreakpoint(initial: boolean) {
  const state = { desktop: initial, listener: undefined as (() => void) | undefined };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      addEventListener: vi.fn((_event: string, listener: () => void) => {
        state.listener = listener;
      }),
      get matches() {
        return state.desktop;
      },
      removeEventListener: vi.fn(),
    })),
  );
  return {
    change(desktop: boolean) {
      state.desktop = desktop;
      act(() => state.listener?.());
    },
  };
}

function setPageHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

describe("MigrateToPubkyRing", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "hidden");
  });

  it("names the action, warns about the code and shows the desktop QR only when asked", async () => {
    const createMigration = vi.fn(async () => Result.ok(createMigrationHandle()));
    stubBreakpoint(true);
    render(
      <MigrateToPubkyRing
        createMigration={createMigration}
        navigationAction="back"
        onBack={vi.fn()}
      />,
    );

    const heading = screen.getByRole("heading", { name: "Use in Pubky Ring." });
    expect(heading.parentElement).toHaveClass("gap-6", "md:gap-3");
    expect(heading.closest("main")).toHaveClass("gap-6", "md:gap-8");
    expect(
      screen.getByRole("link", { name: "Download Pubky Ring on the App Store" }),
    ).toHaveAttribute("href", "https://apps.apple.com/us/app/pubky-ring/id6739356756");
    expect(screen.getByRole("link", { name: "Get Pubky Ring on Google Play" })).toHaveAttribute(
      "href",
      "https://play.google.com/store/apps/details?id=to.pubky.ring&hl=en-US",
    );
    expect(screen.getByRole("button", { name: "Open in Pubky Ring" })).not.toHaveAttribute("href");
    expect(screen.getByAltText("Pubky Ring")).toHaveClass("h-[30px]", "w-[137px]");
    const warning = screen.getByText(QR_WARNING);
    expect(warning.closest("[data-tone]")).toHaveAttribute("data-tone", "warning");
    expect(screen.getByText(/To keep it only in Ring, remove it from this browser/u)).toBeVisible();

    // The secret-bearing code is not created, let alone shown, until the person asks for it.
    await act(async () => undefined);
    expect(createMigration).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("img", { name: "Pubky Ring migration QR code" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/stays hidden until you choose Show QR code/u)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Show QR code" }));
    const qrCode = await screen.findByRole("img", { name: "Pubky Ring migration QR code" });
    expect(createMigration).toHaveBeenCalledOnce();
    expect(qrCode).toHaveClass("size-full");
    expect(qrCode.parentElement).toHaveClass("inset-[4.66%]");
    expect(qrCode.parentElement?.parentElement).toHaveClass("size-48");
    expect(qrCode.parentElement?.parentElement?.parentElement).toHaveClass(
      "rounded-lg",
      "md:flex-row",
      "md:p-8",
    );
    expect(
      qrCode.parentElement?.parentElement?.querySelector('img[src="/brand/pubky-brand-mark.svg"]'),
    ).toHaveAttribute("width", "15");
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide QR code" }));
    expect(
      screen.queryByRole("img", { name: "Pubky Ring migration QR code" }),
    ).not.toBeInTheDocument();
  });

  it("hides and disposes a shown QR code when the page is hidden", async () => {
    const handle = createMigrationHandle();
    const dispose = vi.spyOn(handle, "dispose");
    stubBreakpoint(true);
    render(
      <MigrateToPubkyRing
        createMigration={async () => Result.ok(handle)}
        navigationAction="back"
        onBack={vi.fn()}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR code" }));
    await screen.findByRole("img", { name: "Pubky Ring migration QR code" });

    setPageHidden(false);
    expect(screen.getByRole("img", { name: "Pubky Ring migration QR code" })).toBeInTheDocument();
    setPageHidden(true);

    expect(
      screen.queryByRole("img", { name: "Pubky Ring migration QR code" }),
    ).not.toBeInTheDocument();
    expect(dispose).toHaveBeenCalledOnce();
    expect(handle.url).toBeNull();
  });

  it("generates the URL on confirmation, warns in the drawer and unmounts the QR on close", async () => {
    const handle = createMigrationHandle();
    const dispose = vi.spyOn(handle, "dispose");
    const createMigration = vi.fn(async () => Result.ok(handle));
    render(
      <MigrateToPubkyRing
        createMigration={createMigration}
        navigationAction="back"
        onBack={vi.fn()}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR code" }));

    expect(createMigration).toHaveBeenCalledOnce();
    const dialog = screen.getByRole("dialog", { name: "Scan with Pubky Ring" });
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveClass("w-full", "max-w-none");
    expect(within(dialog).getByText(QR_WARNING)).toBeInTheDocument();
    const qrCode = screen.getByRole("img", { name: "Pubky Ring migration QR code" });
    expect(qrCode).toHaveClass("size-full");
    expect(dialog.querySelector('img[src="/brand/pubky-brand-mark.svg"]')).toHaveAttribute(
      "width",
      "15",
    );
    expect(dialog.querySelector('img[src="/brand/pubky-brand-mark.svg"]')).toHaveAttribute(
      "height",
      "24",
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
    expect(dispose).toHaveBeenCalledOnce();
    expect(handle.url).toBeNull();
  });

  it("closes the QR drawer without showing the code inline when the layout turns desktop", async () => {
    const dialogHandle = createMigrationHandle();
    const disposeDialog = vi.spyOn(dialogHandle, "dispose");
    const createMigration = vi.fn(async () => Result.ok(dialogHandle));
    const breakpoint = stubBreakpoint(false);
    render(
      <MigrateToPubkyRing
        createMigration={createMigration}
        navigationAction="back"
        onBack={vi.fn()}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR code" }));
    expect(screen.getByRole("dialog", { name: "Scan with Pubky Ring" })).toBeInTheDocument();

    breakpoint.change(true);

    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
    expect(disposeDialog).toHaveBeenCalledOnce();
    expect(dialogHandle.url).toBeNull();
    await act(async () => undefined);
    expect(
      screen.queryByRole("img", { name: "Pubky Ring migration QR code" }),
    ).not.toBeInTheDocument();
    expect(createMigration).toHaveBeenCalledOnce();
  });

  it("shows Back for identity management and disposes the QR migration when leaving", async () => {
    const onBack = vi.fn();
    const handle = createMigrationHandle();
    const dispose = vi.spyOn(handle, "dispose");
    render(
      <MigrateToPubkyRing
        createMigration={async () => Result.ok(handle)}
        navigationAction="back"
        onBack={onBack}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR code" }));
    expect(screen.getByRole("dialog", { name: "Scan with Pubky Ring" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
    expect(dispose).toHaveBeenCalledOnce();
    expect(handle.url).toBeNull();
  });

  it("disposes the desktop migration on unmount", async () => {
    const handle = createMigrationHandle();
    const dispose = vi.spyOn(handle, "dispose");
    stubBreakpoint(true);
    const view = render(
      <MigrateToPubkyRing
        createMigration={async () => Result.ok(handle)}
        navigationAction="back"
        onBack={vi.fn()}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR code" }));
    await screen.findByRole("img", { name: "Pubky Ring migration QR code" });

    view.unmount();

    expect(dispose).toHaveBeenCalledOnce();
    expect(handle.url).toBeNull();
  });

  it("disposes a migration that resolves after unmount without rendering it", async () => {
    let settle!: (result: LocalIdentityResult<PubkyRingMigration>) => void;
    stubBreakpoint(true);
    const view = render(
      <MigrateToPubkyRing
        createMigration={() =>
          new Promise<LocalIdentityResult<PubkyRingMigration>>((resolve) => {
            settle = resolve;
          })
        }
        navigationAction="back"
        onBack={vi.fn()}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR code" }));
    view.unmount();

    const handle = createMigrationHandle();
    await act(async () => {
      settle(Result.ok(handle));
    });

    expect(handle.url).toBeNull();
  });

  it("shows Continue for the Google detachment recovery flow", () => {
    const onBack = vi.fn();
    render(
      <MigrateToPubkyRing
        createMigration={async () => Result.ok(createMigrationHandle())}
        navigationAction="continue"
        onBack={onBack}
      />,
    );

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("hands direct import to the browser without retaining an anchor href", async () => {
    const assign = vi.fn();
    const handle = createMigrationHandle();
    const navigate = vi.spyOn(handle, "navigate");
    const createMigration = vi.fn(async () => Result.ok(handle));
    vi.stubGlobal("location", { assign, href: "http://localhost/" });
    render(
      <MigrateToPubkyRing
        createMigration={createMigration}
        navigationAction="back"
        onBack={vi.fn()}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Open in Pubky Ring" }));

    expect(createMigration).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith(MIGRATION_URL);
    expect(navigate).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link", { name: "Open in Pubky Ring" })).not.toBeInTheDocument();
  });

  it("reuses a ready migration for direct import", async () => {
    const handle = createMigrationHandle();
    const navigate = vi.spyOn(handle, "navigate");
    const createMigration = vi.fn(async () => Result.ok(handle));
    vi.stubGlobal("location", { assign: vi.fn(), href: "http://localhost/" });
    render(
      <MigrateToPubkyRing
        createMigration={createMigration}
        navigationAction="back"
        onBack={vi.fn()}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR code" }));
    expect(createMigration).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "Scan with Pubky Ring" })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Open in Pubky Ring" }));

    expect(createMigration).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledOnce();
    expect(handle.url).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
  });

  it("says why an export failed and what to do next", async () => {
    render(
      <MigrateToPubkyRing
        createMigration={async () => Result.err({ code: "storage_unavailable" })}
        navigationAction="back"
        onBack={vi.fn()}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR code" }));

    // A failure the press caused is an alert that takes focus, not muted text.
    const failure = screen.getByRole("alert");
    expect(failure).toHaveTextContent(
      "Passport couldn’t read this key from browser storage. Try again, or download an encrypted backup instead.",
    );
    expect(failure).toHaveFocus();
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
  });

  it("keeps an export failure on screen when the layout changes or the page is hidden", async () => {
    const breakpoint = stubBreakpoint(true);
    render(
      <MigrateToPubkyRing
        createMigration={async () => Result.err({ code: "storage_unavailable" })}
        navigationAction="back"
        onBack={vi.fn()}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR code" }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    breakpoint.change(false);
    setPageHidden(true);

    expect(screen.getByRole("alert")).toHaveTextContent("Passport couldn’t read this key");
  });

  it.each([
    ["Show QR code", "Open in Pubky Ring"],
    ["Open in Pubky Ring", "Show QR code"],
  ])("shows %s as busy while the export it started runs", async (pressedName, otherName) => {
    let settle!: (result: LocalIdentityResult<PubkyRingMigration>) => void;
    vi.stubGlobal("location", { assign: vi.fn(), href: "http://localhost/" });
    render(
      <MigrateToPubkyRing
        createMigration={() =>
          new Promise<LocalIdentityResult<PubkyRingMigration>>((resolve) => {
            settle = resolve;
          })
        }
        navigationAction="back"
        onBack={vi.fn()}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: pressedName }));

    const pressed = screen.getByRole("button", { name: pressedName });
    expect(pressed).toHaveAttribute("aria-busy", "true");
    expect(pressed).toBeEnabled();
    expect(pressed).toHaveFocus();
    const other = screen.getByRole("button", { name: otherName });
    expect(other).toBeDisabled();
    expect(other).not.toHaveAttribute("aria-busy");

    await act(async () => settle(Result.err({ code: "storage_unavailable" })));
    expect(pressed).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("alert")).toHaveFocus();
  });
});
