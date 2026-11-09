/** @vitest-environment jsdom */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  KEYCHAIN_QR_LEAD,
  KEYCHAIN_QR_STEPS,
  KEYCHAIN_QR_TITLE,
  KeychainHandoffCard,
} from "./keychainHandoff";

const STEPS = KEYCHAIN_QR_STEPS;

function usePointer(coarse: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: coarse && query === "(pointer: coarse)",
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function mount(footer?: string, heading: { title?: string; lead?: string } = {}) {
  return render(
    <KeychainHandoffCard
      footer={footer ? <p>{footer}</p> : undefined}
      handoff={<div role="img" aria-label="Keychain QR code" />}
      instructions={STEPS}
      label="Keychain hand-off"
      {...heading}
    />,
  );
}

describe("KeychainHandoffCard", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("says what to do in the QR frames' words, one list for both keychain apps", () => {
    expect(KEYCHAIN_QR_TITLE).toBe("Scan QR with keychain.");
    expect(KEYCHAIN_QR_LEAD).toBe("Use Pubky Ring or Bitkit and follow the instructions below.");
    expect([...KEYCHAIN_QR_STEPS]).toEqual([
      "Open Pubky Ring or Bitkit",
      "Tap ‘Scan’",
      "Scan this QR",
      "Authorize in the app",
    ]);
  });

  it("gives a computer the scan illustration, the code with the footer under it, and what to do in the app", () => {
    usePointer(false);
    const { container } = mount("Classic switch");

    const card = screen.getByRole("region", { name: "Keychain hand-off" });
    const code = within(card).getByRole("img", { name: "Keychain QR code" });
    // What to do after scanning, numbered and in order.
    const list = within(card).getByRole("list");
    expect(list.tagName).toBe("OL");
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((step) => step.textContent),
    ).toEqual([...STEPS]);
    // The footer sits right under the code it changes, in the code's column, before the steps.
    const footer = within(card).getByText("Classic switch");
    expect(footer.parentElement).toBe(code.parentElement);
    expect(code.nextElementSibling).toBe(footer);
    expect(list.contains(footer)).toBe(false);
    expect(code.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(footer.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The illustration is decoration, from lg; neither app's logo is shown beside a code.
    const illustration = container.querySelector('img[src*="scan.png"]');
    expect(illustration).toHaveAttribute("aria-hidden", "true");
    expect(illustration).toHaveClass("hidden", "lg:block");
    expect(within(card).queryByRole("img", { name: "Pubky Ring" })).toBeNull();
    expect(within(card).queryByRole("img", { name: "Bitkit" })).toBeNull();
  });

  it("gives a phone both apps' logos over the button that opens the link, and no steps", () => {
    usePointer(true);
    const { container } = mount("Classic switch");

    const card = screen.getByRole("region", { name: "Keychain hand-off" });
    const ring = within(card).getByRole("img", { name: "Pubky Ring" });
    const bitkit = within(card).getByRole("img", { name: "Bitkit" });
    const handoff = within(card).getByRole("img", { name: "Keychain QR code" });
    expect(ring.compareDocumentPosition(bitkit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(bitkit.compareDocumentPosition(handoff) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(card).queryByRole("list")).toBeNull();
    for (const step of STEPS) expect(within(card).queryByText(step)).toBeNull();
    expect(container.querySelector('img[src*="scan.png"]')).toBeNull();
    // The footer still follows the hand-off.
    const footer = within(card).getByText("Classic switch");
    expect(handoff.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is named by its visible title, with the lead under it, beside the steps on a computer", () => {
    usePointer(false);
    mount("Classic switch", {
      title: KEYCHAIN_QR_TITLE,
      lead: KEYCHAIN_QR_LEAD,
    });

    // The visible heading names the region; the fallback label is not used.
    const card = screen.getByRole("region", { name: "Scan QR with keychain." });
    expect(screen.queryByRole("region", { name: "Keychain hand-off" })).toBeNull();
    expect(card).not.toHaveAttribute("aria-label");
    const heading = within(card).getByRole("heading", { level: 2, name: "Scan QR with keychain." });
    expect(card).toHaveAttribute("aria-labelledby", heading.id);
    const lead = within(card).getByText(
      "Use Pubky Ring or Bitkit and follow the instructions below.",
    );
    expect(heading.compareDocumentPosition(lead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Heading and lead head the steps' column, apart from the code and its footer.
    const list = within(card).getByRole("list");
    expect(lead.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const code = within(card).getByRole("img", { name: "Keychain QR code" });
    expect(code.parentElement?.contains(heading)).toBe(false);
  });

  it("keeps the title and lead over the logos on a phone", () => {
    usePointer(true);
    mount(undefined, {
      title: KEYCHAIN_QR_TITLE,
      lead: KEYCHAIN_QR_LEAD,
    });

    const card = screen.getByRole("region", { name: "Scan QR with keychain." });
    const lead = within(card).getByText(
      "Use Pubky Ring or Bitkit and follow the instructions below.",
    );
    const ring = within(card).getByRole("img", { name: "Pubky Ring" });
    expect(lead.compareDocumentPosition(ring) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is named by its label, with no heading, without a title", () => {
    usePointer(false);
    mount();

    const card = screen.getByRole("region", { name: "Keychain hand-off" });
    expect(within(card).queryByRole("heading")).toBeNull();
  });

  it("adds nothing under the hand-off without a footer", () => {
    usePointer(true);
    mount();

    const card = screen.getByRole("region", { name: "Keychain hand-off" });
    const handoff = within(card).getByRole("img", { name: "Keychain QR code" });
    expect(handoff.parentElement?.nextElementSibling).toBeNull();
  });
});
