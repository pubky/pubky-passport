/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PhoneNumberStep, SmsCodeStep } from "./smsVerification";

const PHONE = "+41791234567";

function codeStep(props: { pending: boolean; error?: string | null; onSendCode?: () => void }) {
  return (
    <SmsCodeStep
      error={props.error ?? null}
      onBack={vi.fn()}
      onSendCode={props.onSendCode ?? vi.fn()}
      onVerify={vi.fn()}
      pending={props.pending}
      phoneNumber={PHONE}
      resendAt={0}
    />
  );
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
});
