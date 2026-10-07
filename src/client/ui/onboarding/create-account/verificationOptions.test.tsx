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
    render(options({ sms: status, lightning: status }, { onInvite, onSms }));
    const sms = screen.queryByRole("button", { name: "Phone number" });
    if (status === "blocked") {
      expect(sms).toBeDisabled();
      // One banner per blocked method from md, one badge beside each button below md.
      expect(screen.getAllByText("Not available in your country")).toHaveLength(2);
      expect(screen.getAllByRole("button", { name: "Why is this not available?" })).toHaveLength(2);
      await userEvent.setup().click(sms!);
      expect(onSms).not.toHaveBeenCalled();
    } else if (status === "checking") {
      // Placeholders keep the layout stable so a tap meant for Invite cannot land elsewhere.
      // Busy rather than disabled: the card stays readable and only the button shows the probe.
      expect(sms).toHaveAttribute("aria-disabled", "true");
      expect(sms).toHaveAttribute("aria-busy", "true");
      expect(sms?.closest('[role="group"]')?.firstElementChild).not.toHaveClass("md:opacity-50");
      expect(screen.getByRole("button", { name: "Bitcoin payment" })).toHaveAttribute(
        "aria-disabled",
        "true",
      );
      expect(screen.queryByText("Not available in your country")).not.toBeInTheDocument();
      await userEvent.setup().click(sms!);
      expect(onSms).not.toHaveBeenCalled();
    } else expect(sms).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Invite code" }));
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
  expect(
    screen.getByRole("heading", { level: 1, name: "Prove you’re not a robot." }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Bitcoin payment/u })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Phone number" })).not.toBeInTheDocument();
  // The lead says why; the provider's storage offer follows it.
  expect(
    screen.getByText(
      "New accounts are verified once to keep out spam. Storage from your own provider.",
    ),
  ).toBeInTheDocument();
  // A lone method is one card, not a grid of one.
  expect(screen.getAllByRole("group")).toHaveLength(1);
  const methods = screen.getByRole("region", { name: "Verification methods" });
  expect(methods).not.toHaveClass("md:grid-cols-2");
  expect(methods).not.toHaveClass("md:grid-cols-3");
  expect(
    screen.getByRole("link", { name: /^Terms of Service of the homeserver provider/u }),
  ).toHaveAttribute("href", "https://provider.example/terms");
  await userEvent.setup().click(screen.getByRole("button", { name: "Invite code" }));
  expect(onInvite).toHaveBeenCalledOnce();
  expect(onLightning).not.toHaveBeenCalled();
});

it("lays two methods out in two columns and three in three", () => {
  const rendered = render(options({ lightning: "unavailable" }));
  expect(screen.getAllByRole("group")).toHaveLength(2);
  const methods = screen.getByRole("region", { name: "Verification methods" });
  expect(methods).toHaveClass("md:grid-cols-2");
  expect(methods).not.toHaveClass("md:grid-cols-3");
  // The cards span the wide column, whatever their number.
  expect(screen.getByRole("main")).toHaveClass("max-w-[1280px]");

  rendered.rerender(withGoogleIdentityConfiguration(options({})));
  expect(screen.getAllByRole("group")).toHaveLength(3);
  expect(methods).toHaveClass("md:grid-cols-3");
  expect(methods).not.toHaveClass("md:grid-cols-2");
});

it("says why accounts are verified and keeps each method's price with its button", async () => {
  const onBack = vi.fn();
  render(options({ amountSat: 1_000 }, { onBack }));

  expect(screen.getByText("New accounts are verified once to keep out spam.")).toBeVisible();
  // From md each method is a card with its title; below md one card holds the three buttons.
  expect(screen.getByRole("heading", { level: 2, name: "Pick verification method" })).toHaveClass(
    "md:hidden",
  );
  for (const [title, button, detail] of [
    ["Small payment", "Bitcoin payment (₿1,000)", "Pay ₿1,000 for secure verification"],
    ["Phone verification", "Phone number", "Less private, but easy & free"],
    ["Invite code", "Invite code", "Have an invite code?"],
  ] as const) {
    const card = screen.getByRole("group", { name: title });
    expect(within(card).getByRole("heading", { level: 2, name: title })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: button })).toHaveAccessibleDescription(detail);
  }
  await userEvent.setup().click(screen.getByRole("button", { name: "Back" }));
  expect(onBack).toHaveBeenCalledOnce();
});

it("describes the payment in the provider's words, and names no price before the probe has one", () => {
  render(options({}));
  expect(screen.getByRole("button", { name: "Bitcoin payment" })).toHaveAccessibleDescription(
    "Pay with Bitcoin",
  );
  cleanup();

  renderView(
    withGoogleIdentityConfiguration(
      options({ amountSat: 1_000 }),
      makeInstanceConfig({ paymentDescription: "One small payment, once." }),
    ),
  );
  expect(
    screen.getByRole("button", { name: "Bitcoin payment (₿1,000)" }),
  ).toHaveAccessibleDescription("One small payment, once.");
});

it("describes the invite as a code the person already has, naming nobody to ask", () => {
  render(options({}));
  expect(screen.queryByText(/Ask us/u)).toBeNull();
  expect(screen.getByRole("button", { name: "Invite code" })).toHaveAccessibleDescription(
    "Have an invite code?",
  );
});

it("says what creating an account agrees to, linking Passport's own terms", () => {
  render(options({}));
  const consent = screen.getByText(/By joining and creating a Pubky account, you agree to the/u);
  expect(consent).toHaveTextContent(
    "By joining and creating a Pubky account, you agree to the Terms of Service and Privacy Policy, and confirm you are at least 18 years old.",
  );
  expect(within(consent).getByRole("link", { name: "Terms of Service" })).toHaveAttribute(
    "href",
    "/terms-of-service",
  );
  expect(within(consent).getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
    "href",
    "/privacy-policy",
  );
});

it("dims a method blocked in the country, with a banner from md and a badge below it", async () => {
  const onSms = vi.fn();
  render(options({ sms: "blocked", amountSat: 1_000 }, { onSms }));
  const card = screen.getByRole("group", { name: "Phone verification" });
  const sms = within(card).getByRole("button", { name: "Phone number" });
  expect(sms).toBeDisabled();
  // The words describe the dimmed button, so a screen reader hears why it does nothing.
  expect(sms).toHaveAccessibleDescription(
    "Less private, but easy & free Not available in your country. Try a different verification method.",
  );
  // From md: the card is dimmed and a banner covers it, silent to screen readers.
  expect(card.firstElementChild).toHaveClass("md:opacity-50", "md:pointer-events-none");
  const banner = within(card).getByText("Not available in your country");
  expect(banner.closest("[aria-hidden]")).toHaveClass("hidden", "md:flex");
  // The other methods are untouched.
  expect(screen.getByRole("button", { name: "Bitcoin payment (₿1,000)" })).toBeEnabled();
  expect(
    within(screen.getByRole("group", { name: "Small payment" })).queryByRole("button", {
      name: "Why is this not available?",
    }),
  ).toBeNull();

  // Below md: the badge beside the button opens the same words with what to do instead.
  const user = userEvent.setup();
  const badge = within(card).getByRole("button", { name: "Why is this not available?" });
  expect(badge).toHaveAttribute("aria-expanded", "false");
  expect(badge.parentElement).toHaveClass("md:hidden");
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

it("announces a lone blocked method as a sentence, naming what is left", () => {
  const view = render(options({ sms: "checking", amountSat: 1_000 }));
  const summary = screen
    .getAllByRole("status")
    .find((status) => status.classList.contains("sr-only"));

  view.rerender(withGoogleIdentityConfiguration(options({ sms: "blocked", amountSat: 1_000 })));

  // The method's name opens the sentence, so it starts with a capital.
  expect(summary).toHaveTextContent(
    /^Phone verification isn’t available in your country\. You can use Bitcoin payment or an invite code\.$/u,
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
    "Bitcoin payment and phone verification aren’t available in your country. You can use an invite code.",
  );
  // The cards' own words stay silent: the banners are hidden and the badges' popovers closed.
  expect(
    screen
      .getAllByRole("status")
      .filter((status) => /available in your country/u.test(status.textContent ?? "")),
  ).toEqual([summary]);
});
