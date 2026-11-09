/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { HowPassportWorks } from "./howPassportWorks";

const TITLE = "How Passport works";
const LEAD = "Use your existing accounts to sign in.";

function renderControl(appleEnabled = false) {
  render(<HowPassportWorks appleEnabled={appleEnabled}>{LEAD}</HowPassportWorks>);
  return screen.getByRole("button", { name: "How?" });
}

function expectExplanation(container: HTMLElement, appleEnabled: boolean): void {
  const account = appleEnabled ? "Apple or Google account" : "Google account";
  const storage = appleEnabled ? "iCloud or Google Drive" : "Google Drive";
  expect(container).toHaveTextContent(
    `Sign-in account: Your ${account} identifies you and keeps your encrypted backup. It does not create or control your pubky.`,
  );
  expect(container).toHaveTextContent(
    `Your keys: Keys are created in your browser and encrypted before they are stored in ${storage}. Your account provider never sees the private key.`,
  );
  expect(container).toHaveTextContent(
    `Recovery: Recovery needs both your encrypted backup in ${storage} and a separate recovery key from Passport.`,
  );
  expect(container).toHaveTextContent(
    "Split security: Passport never gets your backup, and your account provider never gets the key that unlocks it.",
  );
  expect(within(container).queryByRole("link")).not.toBeInTheDocument();
  expect(within(container).getAllByRole("button")).toHaveLength(1);
}

describe("HowPassportWorks", () => {
  afterEach(cleanup);

  it("ends the lead text with a How? button", () => {
    const trigger = renderControl();

    const lead = trigger.closest("p");
    expect(lead).toHaveTextContent(`${LEAD} How?`);
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(lead?.querySelector("div, h2, dialog")).toBeNull();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders on the server as a closed control", () => {
    const markup = renderToStaticMarkup(
      <HowPassportWorks appleEnabled={false}>{LEAD}</HowPassportWorks>,
    );
    const shell = document.body.appendChild(document.createElement("div"));
    shell.innerHTML = markup;

    expect(within(shell).getByRole("button", { name: "How?" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(shell.querySelector("dialog")).not.toHaveAttribute("open");
    shell.remove();
  });

  it("names only Google while Apple login is off", () => {
    fireEvent.click(renderControl(false));

    const dialog = screen.getByRole("dialog", { name: TITLE });
    expect(dialog.tagName).toBe("DIALOG");
    expect(within(dialog).getByRole("heading", { level: 2, name: TITLE })).toBeInTheDocument();
    expectExplanation(dialog, false);
    expect(dialog).not.toHaveTextContent(/Apple|iCloud/u);
  });

  it("names Apple and Google while Apple login is on", () => {
    const trigger = renderControl(true);
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expectExplanation(screen.getByRole("dialog", { name: TITLE }), true);
  });

  it("closes from its Close button, Escape and the backdrop, not from a press inside", () => {
    const trigger = renderControl();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("heading"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(dialog);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
