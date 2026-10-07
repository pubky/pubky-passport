/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import {
  KEYCHAIN_AUTH_METHOD_KEY,
  writeKeychainAuthMethod,
} from "@/client/logic/pubky/keychainAuthMethod";
import { ClassicQrSwitch } from "./classicQrSwitch";

const LABEL = "Older Pubky Ring? Classic QR";

afterEach(() => {
  cleanup();
  // The choice is kept for the device; no test inherits another's.
  writeKeychainAuthMethod("grant");
  localStorage.clear();
});

describe("ClassicQrSwitch", () => {
  it("is an off switch named by its label, until this device chose otherwise", () => {
    render(<ClassicQrSwitch />);

    const classic = screen.getByRole("switch", { name: LABEL });
    expect(classic).not.toBeChecked();
    expect(classic).toHaveAttribute("type", "checkbox");
    expect(classic).not.toHaveAccessibleDescription();
    expect(localStorage.getItem(KEYCHAIN_AUTH_METHOD_KEY)).toBeNull();
  });

  it("is a native switch inside its one label, with no hint or description beside it", () => {
    const { container } = render(<ClassicQrSwitch />);

    const classic = screen.getByRole("switch", { name: LABEL });
    // The label wraps the input: one element names it, nothing else describes it.
    const label = classic.closest("label")!;
    expect(container.querySelectorAll("label")).toHaveLength(1);
    expect(container.firstElementChild).toBe(label);
    expect(label).toHaveTextContent(/^Older Pubky Ring\? Classic QR$/u);
    expect(classic).not.toHaveAttribute("id");
    expect(classic).not.toHaveAttribute("aria-describedby");
    expect(classic).not.toHaveAttribute("aria-label");
    // The old explanatory hint is gone.
    expect(screen.queryByText(/older than 2\.0/u)).toBeNull();
    expect(screen.queryByText(/Use classic QR/u)).toBeNull();
  });

  it("keeps the classic choice for the device while on, says no more than its label, and forgets it when off", async () => {
    const { container } = render(<ClassicQrSwitch />);
    const classic = screen.getByRole("switch", { name: LABEL });
    const user = userEvent.setup();

    await user.click(classic);
    expect(classic).toBeChecked();
    expect(localStorage.getItem(KEYCHAIN_AUTH_METHOD_KEY)).toBe("cookie");
    // On, it still says only its label: no sentence explains it.
    expect(container).toHaveTextContent(/^Older Pubky Ring\? Classic QR$/u);
    expect(classic).not.toHaveAccessibleDescription();

    await user.click(classic);
    expect(classic).not.toBeChecked();
    expect(localStorage.getItem(KEYCHAIN_AUTH_METHOD_KEY)).toBeNull();
  });

  it("is one small line that toggles from its text too", async () => {
    render(<ClassicQrSwitch />);
    const classic = screen.getByRole("switch", { name: LABEL });
    const line = screen.getByText(LABEL);
    expect(line).toHaveClass("text-xs", "text-muted-foreground");

    await userEvent.setup().click(line);
    expect(classic).toBeChecked();
    expect(localStorage.getItem(KEYCHAIN_AUTH_METHOD_KEY)).toBe("cookie");
  });

  it("keeps two switches on the page in step", async () => {
    render(
      <>
        <ClassicQrSwitch />
        <ClassicQrSwitch />
      </>,
    );
    const [first, second] = screen.getAllByRole("switch", { name: LABEL });

    await userEvent.setup().click(first!);
    expect(first).toBeChecked();
    expect(second).toBeChecked();

    await userEvent.setup().click(second!);
    expect(first).not.toBeChecked();
    expect(second).not.toBeChecked();
  });

  it("follows a choice made in another tab", () => {
    render(<ClassicQrSwitch />);
    const classic = screen.getByRole("switch", { name: LABEL });
    expect(classic).not.toBeChecked();

    localStorage.setItem(KEYCHAIN_AUTH_METHOD_KEY, "cookie");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: KEYCHAIN_AUTH_METHOD_KEY }));
    });
    expect(classic).toBeChecked();
  });
});
