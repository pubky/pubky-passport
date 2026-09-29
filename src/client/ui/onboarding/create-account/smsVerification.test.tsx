/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PhoneNumberStep, SmsCodeStep } from "./smsVerification";

const PHONE = "+41791234567";

function codeStep(props: {
  pending: boolean;
  error?: string | null;
  expired?: boolean;
  resendAt?: number;
  onSendCode?: () => void;
}) {
  return (
    <SmsCodeStep
      error={props.error ?? null}
      expired={props.expired ?? false}
      onBack={vi.fn()}
      onSendCode={props.onSendCode ?? vi.fn()}
      onVerify={vi.fn()}
      pending={props.pending}
      phoneNumber={PHONE}
      resendAt={props.resendAt ?? 0}
    />
  );
}

/** The six boxes that echo the hidden code field. */
function codeBoxes() {
  return [...document.querySelectorAll('[aria-hidden="true"].grid > span')];
}

describe("SmsCodeStep", () => {
  afterEach(cleanup);

  it("shows the resend as the work in progress, not a verification", async () => {
    // Like the signup controller, starting a send sets `pending` within the same press.
    function Harness() {
      const [pending, setPending] = useState(false);
      return (
        <>
          {codeStep({ pending, onSendCode: () => setPending(true) })}
          <button onClick={() => setPending(false)} type="button">
            Finish sending
          </button>
        </>
      );
    }
    render(<Harness />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Resend Code" }));

    const resend = screen.getByRole("button", { name: "Sending…" });
    expect(resend).toHaveAttribute("aria-busy", "true");
    expect(resend).toHaveFocus();
    const verify = screen.getByRole("button", { name: "Verify Code" });
    expect(verify).toBeDisabled();
    expect(verify).not.toHaveAttribute("aria-busy");
    expect(screen.queryByText("Verifying…")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Finish sending" }));
    expect(screen.queryByRole("button", { name: "Sending…" })).toBeNull();
    expect(screen.getByRole("button", { name: "Resend Code" })).toBeEnabled();
  });

  it("moves focus to the code field once a sent code starts the resend cooldown", async () => {
    let finishSending!: () => void;
    function Harness() {
      const [pending, setPending] = useState(false);
      const [resendAt, setResendAt] = useState(0);
      finishSending = () => {
        setPending(false);
        setResendAt(Date.now() + 30_000);
      };
      return (
        <SmsCodeStep
          error={null}
          onBack={vi.fn()}
          onSendCode={() => setPending(true)}
          onVerify={vi.fn()}
          pending={pending}
          phoneNumber={PHONE}
          resendAt={resendAt}
        />
      );
    }
    render(<Harness />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Resend Code" }));
    expect(screen.getByRole("button", { name: "Sending…" })).toHaveFocus();
    act(() => finishSending());

    // The cooldown disables Resend natively, which would leave focus on the page.
    expect(screen.getByRole("button", { name: /^Resend \(\d+s\)$/u })).toBeDisabled();
    expect(screen.getByLabelText("Verification code")).toHaveFocus();
  });

  it("keeps focus in the code field while verifying and selects it after a failure", async () => {
    const { rerender } = render(codeStep({ pending: false }));
    const user = userEvent.setup();
    const code = screen.getByLabelText("Verification code");
    await user.type(code, "123456{Enter}");
    rerender(codeStep({ pending: true }));

    expect(code).toHaveFocus();
    expect(code).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Verifying…" })).toHaveAttribute("aria-busy", "true");

    code.blur();
    rerender(codeStep({ pending: false, error: "The code is not valid." }));
    expect(screen.getByRole("alert")).toHaveTextContent("The code is not valid.");
    expect(code).toHaveFocus();
    expect((code as HTMLInputElement).selectionStart).toBe(0);
    expect((code as HTMLInputElement).selectionEnd).toBe(6);
    // Rejected digits turn red instead of keeping the lime of a correct entry.
    for (const box of codeBoxes()) {
      expect(box).toHaveClass("border-destructive", "text-foreground");
      expect(box).not.toHaveClass("text-brand");
    }
  });

  it("starts a new code with the next digit after a wrong one, even after a click", async () => {
    const { rerender } = render(codeStep({ pending: false }));
    const user = userEvent.setup();
    const code = screen.getByLabelText("Verification code");
    await user.type(code, "123456{Enter}");
    rerender(codeStep({ pending: false, error: "That code is incorrect." }));

    // The field is full, so a digit typed at a caret among the rejected ones would be dropped.
    await user.keyboard("7");
    expect(code).toHaveValue("7");
    await user.type(code, "65432");
    rerender(codeStep({ pending: false, error: "That code is incorrect again." }));
    await user.click(code);
    await user.keyboard("9");
    expect(code).toHaveValue("9");
  });

  it("clears an expired code, unlocks Resend and waits for six new digits", async () => {
    const resendAt = Date.now() + 30_000;
    const { rerender } = render(codeStep({ pending: false, resendAt }));
    const user = userEvent.setup();
    const code = screen.getByLabelText("Verification code");
    await user.type(code, "000000");
    expect(screen.getByRole("button", { name: /^Resend \(\d+s\)$/u })).toBeDisabled();

    rerender(
      codeStep({
        pending: false,
        error: "This code has expired or had too many wrong attempts. Send a new code to continue.",
        expired: true,
        resendAt: Date.now(),
      }),
    );
    expect(code).toHaveValue("");
    const resend = screen.getByRole("button", { name: "Resend Code" });
    expect(resend).toBeEnabled();
    const verify = screen.getByRole("button", { name: "Verify Code" });
    expect(verify).toBeDisabled();
    // A new code is the way on, so Resend is the primary until new digits are typed.
    expect(resend).toHaveClass("bg-brand/16");
    expect(verify).toHaveClass("bg-secondary");
    await user.type(code, "123456");
    expect(verify).toBeEnabled();
    expect(verify).toHaveClass("bg-brand/16");
    expect(resend).toHaveClass("bg-secondary");
  });
});

describe("PhoneNumberStep", () => {
  afterEach(cleanup);

  it("shows sending as a busy button and returns to the number after a failure", async () => {
    const step = (pending: boolean, error: string | null) => (
      <PhoneNumberStep
        error={error}
        onBack={vi.fn()}
        onSendCode={vi.fn()}
        pending={pending}
        initialPhoneNumber={PHONE}
      />
    );
    const { rerender } = render(step(false, null));
    await userEvent.setup().click(screen.getByRole("button", { name: "Send Code" }));
    rerender(step(true, null));

    const send = screen.getByRole("button", { name: "Sending code…" });
    expect(send).toHaveAttribute("aria-busy", "true");
    expect(send).toHaveFocus();

    rerender(step(false, "Too many attempts. Try again later."));
    expect(screen.getByLabelText("Phone number")).toHaveFocus();
  });

  it("explains a number without its country code once sent or left, instead of a silent button", async () => {
    const onSendCode = vi.fn();
    render(
      <PhoneNumberStep error={null} onBack={vi.fn()} onSendCode={onSendCode} pending={false} />,
    );
    const user = userEvent.setup();
    const phone = screen.getByLabelText("Phone number");
    await user.type(phone, "079 123 45 67");
    // Not flagged while typed.
    expect(phone).toHaveAttribute("aria-invalid", "false");
    const send = screen.getByRole("button", { name: "Send Code" });
    expect(send).toBeEnabled();
    await user.keyboard("{Enter}");
    expect(onSendCode).not.toHaveBeenCalled();
    const error = screen.getByRole("alert");
    expect(error).toHaveTextContent(
      "Add your country code at the start, for example +41 79 123 45 67.",
    );
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(phone.getAttribute("aria-describedby")?.split(" ")).toContain(error.id);

    await user.clear(phone);
    await user.type(phone, "+41 79 123 45 67");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(send);
    expect(onSendCode).toHaveBeenCalledWith(PHONE);
  });

  it("flags a wrong number when the field is left, but not an empty one", async () => {
    render(<PhoneNumberStep error={null} onBack={vi.fn()} onSendCode={vi.fn()} pending={false} />);
    const user = userEvent.setup();
    await user.tab();
    await user.tab();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Phone number"), "+41 abc");
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("Use only digits after the country code");
  });

  it("drops the valid styling on a refusal, keeps the number from being sent again and offers the alternatives", async () => {
    const onSendCode = vi.fn();
    const onEdit = vi.fn();
    const onLightning = vi.fn();
    const onUseInvite = vi.fn();
    const refusal = { phoneNumber: PHONE, message: "This number has reached its weekly limit." };
    render(
      <PhoneNumberStep
        error={refusal.message}
        initialPhoneNumber={PHONE}
        onBack={vi.fn()}
        onEdit={onEdit}
        onLightning={onLightning}
        onSendCode={onSendCode}
        onUseInvite={onUseInvite}
        pending={false}
        refusal={refusal}
      />,
    );
    const user = userEvent.setup();
    const phone = screen.getByLabelText("Phone number");
    expect(phone).not.toHaveClass("text-brand");
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(refusal.message);
    expect(screen.getByRole("button", { name: "Send Code" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Pay with Lightning instead" }));
    expect(onLightning).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Use an invite code" }));
    expect(onUseInvite).toHaveBeenCalledOnce();

    // Another number may be sent; the refusal is only about the one refused.
    await user.type(phone, "8");
    expect(onEdit).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Send Code" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Use an invite code" })).not.toBeInTheDocument();
  });

  it("says why the number is needed and that only a one-way hash of it is kept", () => {
    render(<PhoneNumberStep error={null} onBack={vi.fn()} onSendCode={vi.fn()} pending={false} />);

    const phone = screen.getByRole("textbox", { name: "Phone number" });
    expect(phone).toHaveAccessibleDescription(
      /only to send this code and to limit sign-ups per number\. The sign-up service keeps a one-way hash of it, never the number itself\. It isn’t added to your Pubky profile or shared with the apps you sign in to\./u,
    );
  });
});
