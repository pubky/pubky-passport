/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import type { SignupTokenStatus } from "@/client/logic/pubky/SignupTokenChecker";
import { withPassportTestProviders } from "@test-utils/googleIdentityConfiguration";
import { InviteCodeStep } from "./inviteCodeStep";

const HOMESERVER = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const CUSTOM_HOMESERVER = "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";
const CODE = "AB12-CD34-EF56";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Lets a test move past the lookup delay without waiting for it in real time. */
function userWithFakeClock() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

function renderStep(
  status: SignupTokenStatus = "valid",
  onContinue: Parameters<typeof InviteCodeStep>[0]["onContinue"] = vi.fn(),
  homeserver = HOMESERVER,
  props: Partial<Parameters<typeof InviteCodeStep>[0]> = {},
) {
  const checkSignupToken = vi.fn(async () => status);
  render(
    withPassportTestProviders(
      <InviteCodeStep
        homeserver={homeserver}
        onBack={vi.fn()}
        onContinue={onContinue}
        {...props}
      />,
      { checkSignupToken },
    ),
  );
  return { checkSignupToken };
}

it("prefills the instance homeserver and lets the person change it", () => {
  renderStep();
  const shown = screen.getByLabelText("Homeserver");
  expect(shown.tagName).toBe("OUTPUT");
  expect(shown).toHaveTextContent(HOMESERVER);
  expect(screen.getByRole("button", { name: "Change homeserver" })).toBeEnabled();
});

it("shows the homeserver before the invite code and focuses the code when one is prefilled", async () => {
  renderStep();
  const homeserver = screen.getByLabelText("Homeserver");
  const code = screen.getByLabelText("Enter invite code");
  // A code is looked up as soon as it is well formed, so the homeserver is chosen first.
  expect(homeserver.compareDocumentPosition(code) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(code).toHaveFocus();

  await userEvent.setup().click(screen.getByRole("button", { name: "Change homeserver" }));
  expect(screen.getByLabelText("Homeserver public key")).toHaveFocus();
});

it("contacts a homeserver the person entered only after they confirm it", async () => {
  const onContinue = vi.fn();
  const user = userWithFakeClock();
  const { checkSignupToken } = renderStep("valid", onContinue);
  await user.click(screen.getByLabelText("Enter invite code"));
  await user.paste(CODE);
  await screen.findByText("Invite verified with the homeserver.");
  expect(checkSignupToken).toHaveBeenCalledOnce();

  await user.click(screen.getByRole("button", { name: "Change homeserver" }));
  // Two lines, so the whole 52-character key can be compared with the one given.
  const editable = screen.getByLabelText("Homeserver public key");
  expect(editable.tagName).toBe("TEXTAREA");
  expect(editable).toHaveAttribute("rows", "2");
  expect(editable).toHaveValue(HOMESERVER);
  await user.clear(editable);
  await user.type(editable, "not-a-homeserver");
  // Not flagged while typed; using it says what a key looks like and keeps the person there.
  expect(editable).not.toHaveAttribute("aria-invalid");
  await user.click(screen.getByRole("button", { name: "Use this homeserver" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "A homeserver public key is 52 letters and digits.",
  );
  expect(editable).toHaveAttribute("aria-invalid", "true");
  expect(editable).toHaveFocus();
  await user.clear(editable);
  await user.paste(CUSTOM_HOMESERVER);
  expect(screen.getByText(/Choose Use this homeserver to check this invite/u)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  await vi.advanceTimersByTimeAsync(400);
  expect(checkSignupToken).toHaveBeenCalledOnce();

  await user.click(screen.getByRole("button", { name: "Use this homeserver" }));
  expect(screen.getByLabelText("Homeserver")).toHaveTextContent(CUSTOM_HOMESERVER);
  await screen.findByText("Invite verified with the homeserver.");
  expect(checkSignupToken).toHaveBeenLastCalledWith(
    { homeserverPubky: CUSTOM_HOMESERVER, signupToken: CODE },
    expect.any(AbortSignal),
  );
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(onContinue).toHaveBeenCalledWith({
    homeserverPubky: CUSTOM_HOMESERVER,
    signupToken: CODE,
  });
});

it("asks for the homeserver when the provider has none, and Enter uses it", async () => {
  const onContinue = vi.fn();
  const user = userWithFakeClock();
  const { checkSignupToken } = renderStep("valid", onContinue, "");
  const editable = screen.getByLabelText("Homeserver public key");
  expect(editable).toHaveValue("");
  expect(editable).toHaveFocus();
  // The way on comes after the field, in reading and Tab order.
  const use = screen.getByRole("button", { name: "Use this homeserver" });
  expect(editable.compareDocumentPosition(use) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  await user.click(screen.getByLabelText("Enter invite code"));
  await user.paste(CODE);
  await user.click(editable);
  // A key pasted across lines keeps no spaces or breaks.
  await user.paste(`${CUSTOM_HOMESERVER.slice(0, 26)}\n${CUSTOM_HOMESERVER.slice(26)} `);
  expect(editable).toHaveValue(CUSTOM_HOMESERVER);
  await vi.advanceTimersByTimeAsync(400);
  expect(checkSignupToken).not.toHaveBeenCalled();

  await user.keyboard("{Enter}");
  await screen.findByText("Invite verified with the homeserver.");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(onContinue).toHaveBeenCalledWith({
    homeserverPubky: CUSTOM_HOMESERVER,
    signupToken: CODE,
  });
});

it("checks a pasted invite with its homeserver and submits it once verified", async () => {
  const onContinue = vi.fn();
  const { checkSignupToken } = renderStep("valid", onContinue);
  const user = userEvent.setup();

  await user.click(screen.getByLabelText("Enter invite code"));
  await user.paste(" ab12-cd34-ef56 ");
  expect(screen.getByText("Checking invite with the homeserver…")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

  expect(await screen.findByText("Invite verified with the homeserver.")).toBeInTheDocument();
  expect(checkSignupToken).toHaveBeenCalledOnce();
  expect(checkSignupToken).toHaveBeenCalledWith(
    { homeserverPubky: HOMESERVER, signupToken: CODE },
    expect.any(AbortSignal),
  );
  await user.click(screen.getByRole("button", { name: "Continue" }));
  expect(onContinue).toHaveBeenCalledWith({ homeserverPubky: HOMESERVER, signupToken: CODE });
});

it("never sends a partial or malformed code to the homeserver", async () => {
  const user = userWithFakeClock();
  const { checkSignupToken } = renderStep();
  const input = screen.getByLabelText("Enter invite code");

  for (const partial of ["A", "AB12", "AB12-", "AB12-CD34", "single-use-invite"]) {
    await user.clear(input);
    await user.type(input, partial);
    expect(screen.getByText("Invite codes have the form XXXX-XXXX-XXXX.")).toBeInTheDocument();
    expect(screen.queryByText(/Checking invite/u)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  }
  await vi.advanceTimersByTimeAsync(400);
  expect(checkSignupToken).not.toHaveBeenCalled();
});

it.each([
  [
    "not_found",
    "This homeserver does not recognize this invite. Check the code, or choose Change homeserver if the invite is from another homeserver.",
  ],
  ["used", "This invite has already been used."],
] as const)("blocks a %s invite with an explanation", async (status, message) => {
  renderStep(status);
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("Enter invite code"));
  await user.paste(CODE);

  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(screen.getByLabelText("Enter invite code")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Verify another way" })).not.toBeInTheDocument();
});

it("offers the other ways to verify when the homeserver refuses the invite", async () => {
  const onChooseAnotherMethod = vi.fn();
  renderStep("used", vi.fn(), HOMESERVER, { onChooseAnotherMethod });
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("Enter invite code"));
  await user.paste(CODE);
  await screen.findByRole("alert");
  await user.click(screen.getByRole("button", { name: "Verify another way" }));
  expect(onChooseAnotherMethod).toHaveBeenCalledOnce();
});

it("says an invite is needed where it is the only way to create an account", () => {
  renderStep("valid", vi.fn(), HOMESERVER, { inviteOnly: true });
  expect(screen.getByText(/Creating an account here needs an invite code/u)).toBeInTheDocument();
  expect(screen.getByText(/Don’t have one\? Invite codes come from/u)).toBeInTheDocument();
});

it("lets an invite continue when the homeserver cannot be reached", async () => {
  renderStep("unknown");
  const user = userEvent.setup();
  await user.click(screen.getByLabelText("Enter invite code"));
  await user.paste(CODE);

  const status = await screen.findByText(/^Could not check this invite with the homeserver\./u);
  expect(status).toHaveTextContent("Check your connection and the homeserver key");
  expect(status).not.toHaveTextContent(/right now/u);
  expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
});
