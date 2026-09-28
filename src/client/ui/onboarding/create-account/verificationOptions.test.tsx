/** @vitest-environment jsdom */
import { cleanup, render as renderView, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { withGoogleIdentityConfiguration } from "@test-utils/googleIdentityConfiguration";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { makeInstanceConfig } from "@test-utils/instanceConfig";
import { PassportProviderConfiguration } from "@/client/ui/passportProviderConfiguration";
import { VerificationOptions } from "./verificationOptions";
import { HomegateAvailabilityContext } from "@/client/ui/homegateAvailability";

afterEach(cleanup);
function render(view: ReactNode) {
  return renderView(withGoogleIdentityConfiguration(view));
}
it.each(["checking", "unavailable", "unknown", "blocked"] as const)(
  "keeps manual invites available when remote methods are %s",
  async (status) => {
    const onInvite = vi.fn();
    const onSms = vi.fn();
    render(
      <HomegateAvailabilityContext
        value={{
          methods: { google: { status }, sms: { status }, lightning: { status } },
          retry: vi.fn(),
        }}
      >
        <VerificationOptions
          onBack={vi.fn()}
          onInvite={onInvite}
          onLightning={vi.fn()}
          onSms={onSms}
        />
      </HomegateAvailabilityContext>,
    );
    const sms = screen.queryByRole("button", { name: "Continue with SMS" });
    if (status === "blocked") {
      expect(sms).toBeDisabled();
      expect(screen.getAllByText("Not available in your country")).toHaveLength(2);
      await userEvent.setup().click(sms!);
      expect(onSms).not.toHaveBeenCalled();
    } else if (status === "checking") {
      // Placeholders keep the layout stable so a tap meant for Invite cannot land elsewhere.
      // Busy rather than disabled: the card stays readable and only the button shows the probe.
      expect(sms).toHaveAttribute("aria-disabled", "true");
      expect(sms).toHaveAttribute("aria-busy", "true");
      expect(sms?.closest('[role="group"]')?.firstElementChild).not.toHaveClass("opacity-50");
      expect(screen.getByRole("button", { name: "Continue with Lightning" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(screen.queryByText("Not available in your country")).not.toBeInTheDocument();
      await userEvent.setup().click(sms!);
      expect(onSms).not.toHaveBeenCalled();
    } else expect(sms).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Enter invite manually" }));
    expect(onInvite).toHaveBeenCalledOnce();
  },
);

it("keeps the pressed retry button mounted, focused and busy while methods are re-checked", () => {
  const retry = vi.fn();
  const context = (status: "unknown" | "checking") => ({
    methods: { google: { status }, sms: { status }, lightning: { status } },
    retry,
  });
  const view = renderView(
    withGoogleIdentityConfiguration(
      <HomegateAvailabilityContext value={context("unknown")}>
        <VerificationOptions
          onBack={vi.fn()}
          onInvite={vi.fn()}
          onLightning={vi.fn()}
          onSms={vi.fn()}
        />
      </HomegateAvailabilityContext>,
    ),
  );
  const checkAgain = screen.getByRole("button", { name: "Check again" });
  expect(checkAgain).toBeEnabled();
  checkAgain.focus();
  view.rerender(
    withGoogleIdentityConfiguration(
      <HomegateAvailabilityContext value={context("checking")}>
        <VerificationOptions
          onBack={vi.fn()}
          onInvite={vi.fn()}
          onLightning={vi.fn()}
          onSms={vi.fn()}
        />
      </HomegateAvailabilityContext>,
    ),
  );
  expect(screen.getByRole("button", { name: "Check again" })).toBe(checkAgain);
  // Natively disabling it would drop focus to the page and dim the one control that was pressed.
  expect(checkAgain).toBeEnabled();
  expect(checkAgain).toHaveFocus();
  expect(checkAgain).toHaveAttribute("aria-busy", "true");
  expect(checkAgain.querySelector('[data-slot="spinner"]')).not.toBeNull();
  expect(screen.getByRole("status", { name: "" })).toHaveTextContent(/Checking available/u);
});

it("shows only supported signup methods and the configured provider terms", async () => {
  const onInvite = vi.fn();
  const onLightning = vi.fn();
  render(
    <PassportProviderConfiguration
      value={makeInstanceConfig({
        features: { google: false },
        verificationMethods: ["invite"],
        storageDescription: "Storage from your own provider.",
        termsUrl: "https://provider.example/terms",
      })}
    >
      <VerificationOptions
        onBack={vi.fn()}
        onInvite={onInvite}
        onLightning={onLightning}
        onSms={vi.fn()}
      />
    </PassportProviderConfiguration>,
  );
  expect(screen.queryByRole("button", { name: "Continue with Lightning" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Continue with SMS" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Terms of service" })).toHaveAttribute(
    "href",
    "https://provider.example/terms",
  );
  // The invite option names no provider.
  expect(screen.getByText("Use an invite from a homeserver")).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Enter invite manually" }));
  expect(onInvite).toHaveBeenCalledOnce();
  expect(onLightning).not.toHaveBeenCalled();
});
