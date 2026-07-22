/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManualAuthorizationForm } from "./manualAuthorizationForm";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

describe("ManualAuthorizationForm", () => {
  afterEach(() => {
    cleanup();
    replace.mockReset();
  });

  it("removes an invalid sensitive request from the UI", async () => {
    const user = userEvent.setup();
    render(<ManualAuthorizationForm allowLocalhostCallbacks={false} relayOrigin="https://httprelay.pubky.app" />);
    const input = screen.getByRole("textbox", { name: "Pubky authorization request" });

    await user.type(input, "pubkyauth://signin?secret=sensitive-secret");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect((input as HTMLTextAreaElement).value).toBe("");
    expect(screen.getByRole("alert").textContent).toBe("Enter a valid Pubky authorization request.");
    expect(document.body.textContent).not.toContain("sensitive-secret");
    expect(replace).not.toHaveBeenCalled();
  });

  it("routes a valid request to capability review", async () => {
    const user = userEvent.setup();
    const request = "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://httprelay.pubky.app/inbox&secret=secret&x-success=https://example.app/success";
    render(<ManualAuthorizationForm allowLocalhostCallbacks={false} relayOrigin="https://httprelay.pubky.app" />);

    await user.type(screen.getByRole("textbox", { name: "Pubky authorization request" }), request);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/authorize?d=${encodeURIComponent(request)}`));
  });
});
