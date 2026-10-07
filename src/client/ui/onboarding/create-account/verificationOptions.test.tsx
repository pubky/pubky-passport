/** @vitest-environment jsdom */
import { cleanup, render as renderView, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { withGoogleIdentityConfiguration } from "@test-utils/googleIdentityConfiguration";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { makeInstanceConfig } from "@test-utils/instanceConfig";
import { PassportProviderConfiguration } from "@/client/ui/passportProviderConfiguration";
import { VerificationOptions } from "./verificationOptions";
import { HomegateAvailabilityContext } from "@/client/ui/homegateAvailability";

type Status = "available" | "blocked" | "checking" | "unavailable" | "unknown";

afterEach(cleanup);
function render(view: ReactNode) {
  return renderView(withGoogleIdentityConfiguration(view));
}

/** The options under the given Homegate answers, with every callback a spy unless given. */
function options(
  methods: { sms?: Status; lightning?: Status; amountSat?: number },
  callbacks: Partial<Parameters<typeof VerificationOptions>[0]> = {},
  retry: () => void = vi.fn(),
) {
  const { sms = "available", lightning = "available", amountSat } = methods;
  return (
    <HomegateAvailabilityContext
      value={{
        methods: {
          google: { status: "available" },
          sms: { status: sms },
          lightning: amountSat ? { status: lightning, amountSat } : { status: lightning },
        },
        retry,
      }}
    >
      <VerificationOptions
        onBack={vi.fn()}
        onInvite={vi.fn()}
        onLightning={vi.fn()}
        onSms={vi.fn()}
        {...callbacks}
      />
    </HomegateAvailabilityContext>
  );
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
      // One banner per blocked method from lg, one badge beside each button below lg.
      expect(screen.getAllByText("Not available in your country")).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: "Why is this not available?" })).toHaveLength(2);
      await userEvent.setup().click(sms!);
      expect(onSms).not.toHaveBeenCalled();
    } else if (status === "checking") {
      // Placeholders keep the layout stable so a tap meant for Invite cannot land elsewhere.
      // Busy rather than disabled: the card stays readable and only the button shows the probe.
      expect(sms).toHaveAttribute("aria-disabled", "true");
      expect(sms).toHaveAttribute("aria-busy", "true");
      expect(sms?.closest('[role="group"]')?.firstElementChild).not.toHaveClass("lg:opacity-50");
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

it("offers Check again only after a check failed, never for a method blocked in the country", async () => {
  const retry = vi.fn();
  const view = render(options({ sms: "blocked" }, {}, retry));
  // A block is an answer: checking again would only give it again.
  expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();

  view.rerender(
    withGoogleIdentityConfiguration(options({ sms: "blocked", lightning: "unknown" }, {}, retry)),
  );
  expect(screen.getByText(/Couldn’t check all verification methods\./u)).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Check again" }));
  expect(retry).toHaveBeenCalledOnce();
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
  expect(screen.getByRole("main")).toHaveClass("min-[64.0625rem]:max-w-[588px]");
  const card = screen.getByRole("group", { name: "Invite code" }).firstElementChild;
  expect(card).toHaveClass("lg:flex-row", "lg:items-center");
  expect(card?.querySelector('img[src*="invite.png"]')).toHaveClass("size-36");
  expect(card?.querySelector('img[src*="invite.png"]')).not.toHaveClass("mx-auto");
  expect(
    screen.getByRole("link", { name: /^Terms of Service of the homeserver provider/u }),
  ).toHaveAttribute("href", "https://provider.example/terms");
  // Only the button: no description under the invite option.
  expect(screen.getByRole("button", { name: "Enter invite manually" })).not.toHaveAttribute(
    "aria-describedby",
  );
  expect(screen.queryByText("Use an invite from a homeserver")).toBeNull();
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
  // The line follows its button (which sits with the room for a blocked method's badge).
  expect(below?.previousElementSibling).toContainElement(price);
  // SMS is just its button: no description under it.
  expect(screen.getByRole("button", { name: "Continue with SMS" })).not.toHaveAttribute(
    "aria-describedby",
  );
  expect(screen.queryByText("Verify with your phone number")).toBeNull();
});

it("dims a method blocked in the country, with a banner from lg and a badge below it", async () => {
  const onSms = vi.fn();
  render(options({ sms: "blocked", amountSat: 1_000 }, { onSms }));
  const card = screen.getByRole("group", { name: "Phone verification" });
  const sms = within(card).getByRole("button", { name: "Continue with SMS" });
  expect(sms).toBeDisabled();
  // The words describe the dimmed button, so a screen reader hears why it does nothing.
  expect(sms).toHaveAccessibleDescription(
    "Not available in your country. Try a different verification method.",
  );
  // From lg: the card is dimmed and a banner covers it, silent to screen readers.
  expect(card.firstElementChild).toHaveClass("lg:opacity-50", "lg:pointer-events-none");
  const banner = within(card).getByText("Not available in your country");
  expect(banner.closest("[aria-hidden]")).toHaveClass("hidden", "lg:flex");
  // The other methods are untouched.
  expect(screen.getByRole("button", { name: "Continue with Lightning" })).toBeEnabled();
  expect(
    within(screen.getByRole("group", { name: "Lightning payment" })).queryByRole("button", {
      name: "Why is this not available?",
    }),
  ).toBeNull();

  // Below lg: the badge beside the button opens the same words with what to do instead.
  const user = userEvent.setup();
  const badge = within(card).getByRole("button", { name: "Why is this not available?" });
  expect(badge).toHaveAttribute("aria-expanded", "false");
  expect(badge.parentElement).toHaveClass("lg:hidden");
  await user.click(badge);
  expect(badge).toHaveAttribute("aria-expanded", "true");
  const popover = document.getElementById(badge.getAttribute("aria-controls")!);
  expect(popover).toHaveTextContent(
    /^Not available in your country\s*Try a different verification method$/u,
  );
  // A second press closes it, as do Escape and a press elsewhere.
  await user.click(badge);
  expect(badge).toHaveAttribute("aria-expanded", "false");
  expect(popover).not.toBeInTheDocument();
  await user.click(badge);
  await user.keyboard("{Escape}");
  expect(badge).toHaveAttribute("aria-expanded", "false");
  await user.click(badge);
  await user.click(screen.getByRole("heading", { level: 1 }));
  expect(badge).toHaveAttribute("aria-expanded", "false");
  expect(onSms).not.toHaveBeenCalled();
});

it("keeps a blocked Lightning's line with its button and adds why it is not available", () => {
  render(options({ lightning: "blocked" }));
  const lightning = screen.getByRole("button", { name: "Continue with Lightning" });
  expect(lightning).toBeDisabled();
  // A blocked probe names no price, so the line says only what the method is.
  expect(lightning).toHaveAccessibleDescription(
    "Verify with a Lightning payment Not available in your country. Try a different verification method.",
  );
  expect(screen.getByRole("button", { name: "Continue with SMS" })).toBeEnabled();
});

it("announces a lone blocked method as a sentence, naming what is left", () => {
  const view = render(options({ sms: "checking", amountSat: 1_000 }));
  const summary = screen
    .getAllByRole("status")
    .find((status) => status.classList.contains("sr-only"));
  expect(summary).toBeEmptyDOMElement();

  view.rerender(withGoogleIdentityConfiguration(options({ sms: "blocked", amountSat: 1_000 })));

  // The live region was already there, so the block is announced once, naming the method.
  expect(summary).toHaveTextContent(
    /^SMS isn’t available in your country\. You can use Lightning or an invite code\.$/u,
  );
});

it("announces the methods blocked in the country once, and what is left", () => {
  const view = render(options({ sms: "checking", lightning: "checking" }));
  const summary = screen
    .getAllByRole("status")
    .find((status) => status.classList.contains("sr-only"));
  expect(summary).toBeEmptyDOMElement();

  view.rerender(withGoogleIdentityConfiguration(options({ sms: "blocked", lightning: "blocked" })));

  // The live region was already there, so the block is announced once, naming the methods.
  expect(summary).toHaveTextContent(
    "Lightning and SMS aren’t available in your country. You can use an invite code.",
  );
  // The cards' own words stay silent: the banners are hidden and the badges' popovers closed.
  expect(
    screen
      .getAllByRole("status")
      .filter((status) => /available in your country/u.test(status.textContent ?? "")),
  ).toEqual([summary]);
});
