/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MethodAvailability } from "@/client/logic/homegate/HomegateAvailabilityClient";
import { describeBlockedMethods, GoogleSignupAvailability } from "./verificationAvailability";

afterEach(cleanup);

describe("describeBlockedMethods", () => {
  it.each([
    [[], ["Lightning"], ""],
    [["SMS"], [], "SMS isn’t available in your country."],
    [
      ["SMS"],
      ["Lightning", "an invite code"],
      "SMS isn’t available in your country. You can use Lightning or an invite code.",
    ],
    [
      ["Lightning", "SMS"],
      ["an invite code"],
      "Lightning and SMS aren’t available in your country. You can use an invite code.",
    ],
    // A sentence starts with a capital, whatever the first method's name is.
    [
      ["phone verification"],
      ["an invite code"],
      "Phone verification isn’t available in your country. You can use an invite code.",
    ],
  ])("describes %o blocked with %o left", (blocked, usable, sentence) => {
    expect(describeBlockedMethods(blocked, usable)).toBe(sentence);
  });
});

describe("GoogleSignupAvailability", () => {
  function renderNote(status: MethodAvailability["status"], onRetry = vi.fn()) {
    const view = render(<GoogleSignupAvailability availability={{ status }} onRetry={onRetry} />);
    return {
      onRetry,
      update: (next: MethodAvailability["status"]) =>
        view.rerender(
          <GoogleSignupAvailability availability={{ status: next }} onRetry={onRetry} />,
        ),
    };
  }

  it("keeps Check again focused through the re-check it starts", async () => {
    const { onRetry, update } = renderNote("blocked");
    const retry = screen.getByRole("button", { name: "Check again" });

    await userEvent.setup().click(retry);
    expect(onRetry).toHaveBeenCalledOnce();
    update("checking");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking whether new Google sign-ups are available…",
    );
    expect(retry).toBeInTheDocument();
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute("aria-busy", "true");

    // The result is said in the same note, which takes the focus Check again leaves with.
    update("available");
    expect(screen.getByRole("status")).toHaveTextContent("New Google sign-ups are available here.");
    expect(screen.queryByRole("button", { name: "Check again" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveFocus();
  });

  it("shows nothing when the first check finds sign-ups available", () => {
    renderNote("checking").update("available");

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not take focus from elsewhere when a re-check finds sign-ups available", async () => {
    const onRetry = vi.fn();
    const note = (status: MethodAvailability["status"]) => (
      <>
        <GoogleSignupAvailability availability={{ status }} onRetry={onRetry} />
        <button type="button">Continue with Google</button>
      </>
    );
    const view = render(note("unknown"));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Check again" }));
    view.rerender(note("checking"));
    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    view.rerender(note("available"));
    expect(screen.getByRole("status")).toHaveTextContent("New Google sign-ups are available here.");
    expect(screen.getByRole("button", { name: "Continue with Google" })).toHaveFocus();
  });

  it("names Google, not verification methods or invite codes", () => {
    renderNote("unknown");

    expect(screen.getByRole("status")).toHaveTextContent(/new Google sign-ups/u);
    expect(screen.getByRole("status")).not.toHaveTextContent(/verification methods|invite code/u);
  });
});
