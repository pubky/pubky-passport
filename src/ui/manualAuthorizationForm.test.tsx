/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BrowserManualAuthorizationController } from "../browser/authorization/browserManualAuthorizationController";
import { ManualAuthorizationForm } from "./manualAuthorizationForm";

const ENTER = vi.fn<BrowserManualAuthorizationController["enter"]>();
const AUTHORIZATION: BrowserManualAuthorizationController = { enter: ENTER };

describe("ManualAuthorizationForm", () => {
  afterEach(() => {
    cleanup();
    ENTER.mockReset();
  });

  it("removes an invalid sensitive request from the UI", async () => {
    const user = userEvent.setup();
    ENTER.mockReturnValue("invalid");
    render(<ManualAuthorizationForm authorization={AUTHORIZATION} />);
    const input = screen.getByRole("textbox", { name: "Pubky authorization request" });

    await user.type(input, "pubkyauth://signin?secret=sensitive-secret");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect((input as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("alert").textContent).toBe(
      "The invalid request was cleared for security. Correct it in the source app, then paste the complete request again.",
    );
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("autocapitalize")).toBe("none");
    expect(input.getAttribute("autocorrect")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(document.body.textContent).not.toContain("sensitive-secret");
    expect(ENTER).toHaveBeenCalledWith("pubkyauth://signin?secret=sensitive-secret");
  });

  it("routes a valid request to capability review", async () => {
    const user = userEvent.setup();
    const request = "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=secret&x-success=https://example.app/success";
    ENTER.mockReturnValue("navigating");
    render(<ManualAuthorizationForm authorization={AUTHORIZATION} />);

    await user.type(screen.getByRole("textbox", { name: "Pubky authorization request" }), request);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(ENTER).toHaveBeenCalledWith(request);
    expect((screen.getByRole("textbox", { name: "Pubky authorization request" }) as HTMLTextAreaElement).value).toBe("");
  });

});
