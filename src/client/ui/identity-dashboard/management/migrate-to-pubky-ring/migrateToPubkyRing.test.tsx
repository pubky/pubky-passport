/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Keypair } from "@synonymdev/pubky";
import userEvent from "@testing-library/user-event";
import { Result } from "better-result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LocalIdentityResult } from "@/client/logic/local-identity/LocalStorageIdentityRepository";
import { PubkyRingMigration } from "@/client/logic/pubky/PubkySdkAdapter";
import { MigrateToPubkyRing } from "./migrateToPubkyRing";

const MOCKS = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: MOCKS.toastError } }));
const EXPORT_FAILED =
  "Passport couldn’t read this key from browser storage. Try again, or download a recovery file instead.";

const MIGRATION_URL =
  "pubkyring://000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

function createMigrationHandle(): PubkyRingMigration {
  return new PubkyRingMigration(
    Keypair.fromSecret(Uint8Array.from({ length: 32 }, (_, index) => index)),
  );
}

const QR_WARNING =
  "This code contains your private key. Anyone who scans it can use your pubky. Don’t show it on a shared or recorded screen.";

const DESKTOP_QUERY = "(min-width: 48rem)";
const COARSE_POINTER_QUERY = "(pointer: coarse)";

/**
 * Stubs the desktop breakpoint and the pointer: a desktop layout comes with a computer's fine
 * pointer and a narrow one with a phone's coarse pointer unless `coarse` says otherwise.
 * `change()` fires the breakpoint listener the screen registered.
 */
function stubBreakpoint(initial: boolean, { coarse = !initial }: { coarse?: boolean } = {}) {
  const state = { desktop: initial, listeners: new Map<string, () => void>() };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      addEventListener: vi.fn((_event: string, listener: () => void) => {
        state.listeners.set(query, listener);
      }),
      get matches() {
        return query === COARSE_POINTER_QUERY ? coarse : state.desktop;
      },
      removeEventListener: vi.fn(),
    })),
  );
  return {
    change(desktop: boolean) {
      state.desktop = desktop;
      act(() => state.listeners.get(DESKTOP_QUERY)?.());
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
  // Every test starts on a phone (narrow layout, coarse pointer); a computer is stubbed per test.
  beforeEach(() => {
    stubBreakpoint(false);
  });

  afterEach(() => {
    cleanup();
    MOCKS.toastError.mockClear();
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

    expect(screen.getByRole("heading", { name: "Migrate to Pubky Ring." })).toBeInTheDocument();
    // The shared Ring card: the store links under the code, inside the card, before the actions.
    const card = screen.getByRole("region", { name: "Copy your key to Pubky Ring" });
    expect(card).toHaveClass("rounded-md", "bg-card");
    expect(card.querySelector('img[src*="scan.png"]')).not.toBeNull();
    const store = within(card).getByRole("link", { name: "Download Pubky Ring on the App Store" });
    expect(store).toHaveAttribute("href", "https://apps.apple.com/us/app/pubky-ring/id6739356756");
    expect(
      within(card).getByRole("button", { name: "Show QR code" }).compareDocumentPosition(store) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      store.compareDocumentPosition(screen.getByRole("button", { name: "Back" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Get Pubky Ring on Google Play" })).toHaveAttribute(
      "href",
      "https://play.google.com/store/apps/details?id=to.pubky.ring&hl=en-US",
    );
    // A computer cannot open Ring, so it gets only the QR code.
    expect(screen.queryByRole("button", { name: "Open in Pubky Ring" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Continue with Pubky Ring" }),
    ).not.toBeInTheDocument();
    const warning = screen.getByText(QR_WARNING);
    expect(warning.closest("[data-tone]")).toHaveAttribute("data-tone", "warning");
    // What follows the export is the screen's status line.
    expect(
      screen.getByText(/To keep it only in Pubky Ring, remove it from this browser/u),
    ).toHaveAttribute("role", "status");

    // The secret-bearing code is not created, let alone shown, until the person asks for it.
    await act(async () => undefined);
    expect(createMigration).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("img", { name: "Pubky Ring migration QR code" }),
    ).not.toBeInTheDocument();
    // The square itself is the control: no separate Show or Hide button beside it.
    const square = screen.getByRole("button", { name: "Show QR code" });
    expect(screen.getAllByRole("button", { name: /QR code/u })).toEqual([square]);
    expect(square).toHaveAttribute("aria-expanded", "false");
    expect(square).toHaveTextContent("to show QR code");
    expect(square.parentElement).toHaveClass("size-48");

    const user = userEvent.setup();
    // A real button: the keyboard reaches and presses it.
    square.focus();
    await user.keyboard("{Enter}");
    const qrCode = await screen.findByRole("img", { name: "Pubky Ring migration QR code" });
    expect(createMigration).toHaveBeenCalledOnce();
    // The same button, now over the code, hides it again; focus never leaves it.
    expect(square).toHaveAccessibleName("Hide QR code");
    expect(square).toHaveAttribute("aria-expanded", "true");
    expect(square).toHaveFocus();
    expect(square).not.toContainElement(qrCode);
    expect(qrCode).toHaveClass("size-full");
    // The shared Pubky Ring code: a light tile with Ring's mark over its centre.
    const tile = qrCode.parentElement!;
    expect(tile).toHaveClass("size-full", "rounded-md", "bg-foreground");
    expect(tile.parentElement?.parentElement).toBe(square.parentElement);
    // In the shared Ring card, centred above the store badges like every other code.
    expect(square.parentElement?.parentElement).toHaveClass("items-center");
    expect(square.closest("section")).toHaveAccessibleName("Copy your key to Pubky Ring");
    expect(tile.querySelector('img[src="/brand/ring-logo.svg"]')).toHaveAttribute("alt", "");
    // The code is the private key: pressing it copies nothing.
    expect(within(tile).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();

    await user.click(square);
    expect(
      screen.queryByRole("img", { name: "Pubky Ring migration QR code" }),
    ).not.toBeInTheDocument();
    expect(square).toHaveAccessibleName("Show QR code");
    expect(square).toHaveAttribute("aria-expanded", "false");
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
    // A narrow window on a computer: the code opens in a drawer.
    stubBreakpoint(false, { coarse: false });
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
    expect(dialog.querySelector('img[src="/brand/ring-logo.svg"]')).toHaveAttribute("alt", "");
    // The code is the private key: no press target copies it to the clipboard.
    expect(
      within(dialog).queryByRole("button", { name: "Copy authentication link" }),
    ).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
    expect(dispose).toHaveBeenCalledOnce();
    expect(handle.url).toBeNull();
  });

  it("closes the QR drawer without showing the code inline when the layout turns desktop", async () => {
    const dialogHandle = createMigrationHandle();
    const disposeDialog = vi.spyOn(dialogHandle, "dispose");
    const createMigration = vi.fn(async () => Result.ok(dialogHandle));
    const breakpoint = stubBreakpoint(false, { coarse: false });
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
    // A narrow window on a computer: the code opens in a drawer.
    stubBreakpoint(false, { coarse: false });
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

  it("returns from the Google detachment recovery flow with Done", () => {
    const onBack = vi.fn();
    render(
      <MigrateToPubkyRing
        createMigration={async () => Result.ok(createMigrationHandle())}
        navigationAction="done"
        onBack={onBack}
      />,
    );

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    // Ring cannot report an import, so the button claims no more than leaving the screen.
    expect(screen.queryByRole("button", { name: "Continue" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("goes on to the Ring check with Continue, withdrawing the code first", async () => {
    const handle = createMigrationHandle();
    const dispose = vi.spyOn(handle, "dispose");
    const onBack = vi.fn();
    const onContinue = vi.fn();
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(min-width: 48rem)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(
      <MigrateToPubkyRing
        createMigration={async () => Result.ok(handle)}
        navigationAction="back"
        onBack={onBack}
        onContinue={onContinue}
      />,
    );

    // The status line says what Continue leads to.
    expect(
      screen
        .getAllByRole("status")
        .find((status) => /Once Pubky Ring has it/u.test(status.textContent ?? "")),
    ).toHaveTextContent("Continue to check that Pubky Ring holds it.");
    fireEvent.click(screen.getByRole("button", { name: "Show QR code" }));
    expect(await screen.findByRole("img", { name: "Pubky Ring migration QR code" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledOnce();
    expect(onBack).not.toHaveBeenCalled();
    // The secret-bearing code does not outlive the screen it was shown on.
    expect(dispose).toHaveBeenCalled();
    expect(screen.queryByRole("img", { name: "Pubky Ring migration QR code" })).toBeNull();
    // Back stays beside it.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("offers Continue instead of Done in the Google detachment flow when the check follows", () => {
    const onContinue = vi.fn();
    render(
      <MigrateToPubkyRing
        createMigration={async () => Result.ok(createMigrationHandle())}
        navigationAction="done"
        onBack={vi.fn()}
        onContinue={onContinue}
      />,
    );

    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledOnce();
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

  it("shows a phone no code at all: no square, no warning, only Open in Pubky Ring", () => {
    render(
      <MigrateToPubkyRing
        createMigration={vi.fn(async () => Result.ok(createMigrationHandle()))}
        navigationAction="back"
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Open in Pubky Ring" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show QR code" })).not.toBeInTheDocument();
    expect(screen.queryByText(QR_WARNING)).not.toBeInTheDocument();
    expect(screen.queryByText(/Scan the code/u)).not.toBeInTheDocument();
    expect(screen.getByText(/Open this pubky in Pubky Ring to add it there/u)).toBeInTheDocument();
  });

  it("offers Open in Pubky Ring on a wide layout with a coarse pointer", () => {
    stubBreakpoint(true, { coarse: true });
    render(
      <MigrateToPubkyRing
        createMigration={async () => Result.ok(createMigrationHandle())}
        navigationAction="back"
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Open in Pubky Ring" })).not.toHaveAttribute("href");
  });

  it("keeps Open in Pubky Ring, and shows no code, when Ring did not open on the phone", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    vi.stubGlobal("location", { assign: vi.fn(), href: "http://localhost/" });
    const createMigration = vi.fn(async () => Result.ok(createMigrationHandle()));
    render(
      <MigrateToPubkyRing
        createMigration={createMigration}
        navigationAction="back"
        onBack={vi.fn()}
      />,
    );

    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole("button", { name: "Open in Pubky Ring" }));
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });

    // Nothing takes over the screen: the same button tries again, and no code is made for it.
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Pubky Ring migration QR code" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open in Pubky Ring" })).toBeEnabled();
    expect(createMigration).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("says why an export failed and what to do next", async () => {
    // A narrow window on a computer: the code opens in a drawer.
    stubBreakpoint(false, { coarse: false });
    render(
      <MigrateToPubkyRing
        createMigration={async () => Result.err({ code: "storage_unavailable" })}
        navigationAction="back"
        onBack={vi.fn()}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR code" }));

    // Said in an error toast that stays until read or closed, not in a box in the card; the
    // pressed square keeps focus, ready to try again.
    expect(MOCKS.toastError).toHaveBeenCalledExactlyOnceWith(
      EXPORT_FAILED,
      expect.objectContaining({ closeButton: true, duration: 10_000 }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "Show QR code" })).toHaveFocus();
    expect(screen.queryByRole("dialog", { name: "Scan with Pubky Ring" })).not.toBeInTheDocument();
  });

  it("says an export failure once, whether the layout changes or the page is hidden after it", async () => {
    const breakpoint = stubBreakpoint(true);
    render(
      <MigrateToPubkyRing
        createMigration={async () => Result.err({ code: "storage_unavailable" })}
        navigationAction="back"
        onBack={vi.fn()}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Show QR code" }));
    expect(MOCKS.toastError).toHaveBeenCalledOnce();

    breakpoint.change(false);
    setPageHidden(true);

    expect(MOCKS.toastError).toHaveBeenCalledExactlyOnceWith(EXPORT_FAILED, expect.anything());
    expect(screen.getByRole("button", { name: "Show QR code" })).toBeEnabled();
  });

  it.each([
    ["Show QR code", "a computer", false],
    ["Open in Pubky Ring", "a phone", true],
  ] as const)(
    "shows %s as busy on %s while the export it started runs",
    async (pressedName, _device, coarse) => {
      stubBreakpoint(false, { coarse });
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
      expect(pressed).toHaveFocus();
      // The other way is not offered on this device at all.
      expect(
        screen.queryByRole("button", {
          name: pressedName === "Show QR code" ? "Open in Pubky Ring" : "Show QR code",
        }),
      ).toBeNull();

      await act(async () => settle(Result.err({ code: "storage_unavailable" })));
      expect(pressed).not.toHaveAttribute("aria-busy");
      expect(pressed).toHaveFocus();
      expect(MOCKS.toastError).toHaveBeenCalledExactlyOnceWith(EXPORT_FAILED, expect.anything());
    },
  );
});
