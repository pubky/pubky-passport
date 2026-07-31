/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ManualAuthorizationEntryResult } from "../browser/authorization/browserManualAuthorization";
import { ManualAuthorizationForm } from "./manualAuthorizationForm";

const ENTER_AUTHORIZATION = sanitizedEntryRecorder();

describe("ManualAuthorizationForm", () => {
  afterEach(() => {
    cleanup();
    ENTER_AUTHORIZATION.reset();
    vi.restoreAllMocks();
  });

  it("removes an invalid sensitive request from the UI", async () => {
    const user = userEvent.setup();
    ENTER_AUTHORIZATION.result = "invalid";
    render(<ManualAuthorizationForm enterAuthorization={ENTER_AUTHORIZATION} />);
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
    expect(ENTER_AUTHORIZATION.record).toEqual({ calls: 1, scheme: "pubkyauth:", queryKeys: ["secret"] });
    expect(JSON.stringify(ENTER_AUTHORIZATION.record)).not.toContain("sensitive-secret");
  });

  it("routes a valid request to capability review", async () => {
    const user = userEvent.setup();
    const request = "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=secret-value-canary&x-success=https://example.app/success";
    ENTER_AUTHORIZATION.result = "navigating";
    render(<ManualAuthorizationForm enterAuthorization={ENTER_AUTHORIZATION} />);

    await user.type(screen.getByRole("textbox", { name: "Pubky authorization request" }), request);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(ENTER_AUTHORIZATION.record).toEqual({
      calls: 1,
      scheme: "pubkyauth:",
      queryKeys: ["caps", "relay", "secret", "x-success"],
    });
    expect(JSON.stringify(ENTER_AUTHORIZATION.record)).not.toContain("secret-value-canary");
    expect((screen.getByRole("textbox", { name: "Pubky authorization request" }) as HTMLTextAreaElement).value).toBe("");
  });

  it("clears and safely reports entry exceptions", async () => {
    const enterAuthorization = vi.fn((): ManualAuthorizationEntryResult => {
      throw new Error("secret-value-canary");
    });
    render(<ManualAuthorizationForm enterAuthorization={enterAuthorization} />);

    await userEvent.setup().type(screen.getByRole("textbox"), "pubkyauth://signin?secret=secret-value-canary");
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Passport could not process the authorization request. Try again.");
    expect(document.body.textContent).not.toContain("secret-value-canary");
  });

});

function sanitizedEntryRecorder() {
  let result: ManualAuthorizationEntryResult = "invalid";
  let record = { calls: 0, scheme: undefined as string | undefined, queryKeys: [] as string[] };
  const enter = (rawRequest: string): ManualAuthorizationEntryResult => {
      const parsed = new URL(rawRequest);
      record = {
        calls: record.calls + 1,
        scheme: parsed.protocol,
        queryKeys: [...parsed.searchParams.keys()].sort(),
      };
      return result;
    };
  return Object.defineProperties(enter, {
    result: { get: () => result, set: (value: ManualAuthorizationEntryResult) => { result = value; } },
    record: { get: () => record },
    reset: { value: () => {
      result = "invalid";
      record = { calls: 0, scheme: undefined, queryKeys: [] };
    } },
  }) as typeof enter & {
    result: ManualAuthorizationEntryResult;
    readonly record: typeof record;
    reset(): void;
  };
}
