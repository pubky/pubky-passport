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
      // One warning per blocked method: the named row below lg and the overlay from lg.
      expect(screen.getByText("Phone verification: not available in your country")).toBeVisible();
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
  expect(screen.getByText(/Checking available/u)).toHaveAttribute("role", "status");
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
  // The lead says what to do; the provider's storage offer is a detail beneath it.
  expect(
    screen.getByText("Choose how to verify and create your Pubky account."),
  ).toBeInTheDocument();
  expect(screen.getByText(/Storage from your own provider\./u)).toHaveClass(
    "text-muted-foreground",
  );
  // A lone method keeps the step column rather than one card across the page, with its
  // illustration beside the text and the button fitted to that column.
  expect(screen.getByRole("main")).toHaveClass("max-w-[588px]");
  expect(screen.getByRole("main")).not.toHaveClass("max-w-[1280px]");
  const card = screen.getByRole("group", { name: "Invite code" }).firstElementChild;
  expect(card).toHaveClass("lg:flex-row", "lg:items-center");
  expect(card?.querySelector('img[src*="invite.png"]')).toHaveClass("size-36");
  expect(card?.querySelector('img[src*="invite.png"]')).not.toHaveClass("mx-auto");
  expect(
    screen.getByRole("link", { name: /^Terms of Service of the homeserver provider/u }),
  ).toHaveAttribute("href", "https://provider.example/terms");
  // The invite option names no provider.
  expect(screen.getByRole("button", { name: "Enter invite manually" })).toHaveAccessibleDescription(
    "Use an invite from a homeserver",
  );
  await userEvent.setup().click(screen.getByRole("button", { name: "Enter invite manually" }));
  expect(onInvite).toHaveBeenCalledOnce();
  expect(onLightning).not.toHaveBeenCalled();
});

it("keeps two methods in an 800px column and three across the wide page", () => {
  const view = (lightning: "available" | "unavailable") => (
    <HomegateAvailabilityContext
      value={{
        methods: {
          google: { status: "available" },
          sms: { status: "available" },
          lightning: { status: lightning },
        },
        retry: vi.fn(),
      }}
    >
      <VerificationOptions
        onBack={vi.fn()}
        onInvite={vi.fn()}
        onLightning={vi.fn()}
        onSms={vi.fn()}
      />
    </HomegateAvailabilityContext>
  );
  const rendered = render(view("unavailable"));
  expect(screen.getAllByRole("group")).toHaveLength(2);
  // The heading, the cards and Back share the narrower column, so they keep one edge.
  expect(screen.getByRole("main")).toHaveClass("max-w-[1280px]", "lg:max-w-[880px]");
  const card = screen.getByRole("group", { name: "Phone verification" }).firstElementChild;
  expect(card).not.toHaveClass("lg:flex-row");
  expect(card?.querySelector('img[src*="sms-verification.png"]')).toHaveClass("size-48");

  rendered.rerender(withGoogleIdentityConfiguration(view("available")));
  expect(screen.getAllByRole("group")).toHaveLength(3);
  expect(screen.getByRole("main")).not.toHaveClass("lg:max-w-[880px]");
});

it("says why accounts are verified and keeps each method's price with its button", () => {
  render(
    <HomegateAvailabilityContext
      value={{
        methods: {
          google: { status: "available" },
          sms: { status: "available" },
          lightning: { status: "available", amountSat: 1_000 },
        },
        retry: vi.fn(),
      }}
    >
      <VerificationOptions
        onBack={vi.fn()}
        onInvite={vi.fn()}
        onLightning={vi.fn()}
        onSms={vi.fn()}
      />
    </HomegateAvailabilityContext>,
  );

  expect(screen.getByText("New accounts are verified once to keep out spam.")).toBeVisible();
  // Below lg the cards collapse to their buttons; the detail under each stays in view there.
  const price = screen.getByRole("button", { name: "Continue with Lightning" });
  expect(price).toHaveAccessibleDescription("Verify with 1,000 sats");
  const below = document.getElementById(price.getAttribute("aria-describedby")!);
  expect(below).toHaveClass("lg:hidden");
  expect(below?.previousElementSibling).toBe(price);
  expect(screen.getByRole("button", { name: "Continue with SMS" })).toHaveAccessibleDescription(
    "Verify with your phone number",
  );
});

it("names each blocked method under its button and announces the blocks once", () => {
  const context = (sms: "checking" | "blocked") => ({
    methods: {
      google: { status: "available" as const },
      sms: { status: sms },
      lightning: { status: "available" as const, amountSat: 1_000 },
    },
    retry: vi.fn(),
  });
  const options = (sms: "checking" | "blocked") =>
    withGoogleIdentityConfiguration(
      <HomegateAvailabilityContext value={context(sms)}>
        <VerificationOptions
          onBack={vi.fn()}
          onInvite={vi.fn()}
          onLightning={vi.fn()}
          onSms={vi.fn()}
        />
      </HomegateAvailabilityContext>,
    );
  const view = renderView(options("checking"));
  const summary = screen
    .getAllByRole("status")
    .find((status) => status.classList.contains("sr-only"));
  expect(summary).toBeEmptyDOMElement();

  view.rerender(options("blocked"));

  // The live region was already there, so the block is announced once, naming the method.
  expect(summary).toHaveTextContent(
    "SMS isn’t available in your country. You can use Lightning or an invite code.",
  );
  const warning = screen.getByText("Phone verification: not available in your country");
  expect(warning).not.toHaveAttribute("role");
  // Below lg the row follows the method's own button and price, inside its group.
  const card = screen.getByRole("group", { name: "Phone verification" });
  expect(card).toContainElement(warning);
  expect(card).toHaveAccessibleDescription("Phone verification: not available in your country");
  expect(
    screen.getByRole("button", { name: "Continue with SMS" }).compareDocumentPosition(warning),
  ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(warning).toHaveClass("lg:hidden");
  expect(screen.getByText("Not available in your country").closest("[aria-hidden]")).toHaveClass(
    "lg:flex",
  );
  expect(
    screen
      .getAllByRole("status")
      .filter((status) => /available in your country/u.test(status.textContent ?? "")),
  ).toEqual([summary]);
});
