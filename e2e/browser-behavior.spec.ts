import { mockPublicProfile, seedProfileIdentity } from "./helpers/pubkyProfile";
import AxeBuilder from "@axe-core/playwright";
import { storeLocalIdentities } from "./helpers/localIdentities";
import { expect, test, type Page } from "./helpers/passportTest";

const FIRST_KEY = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECOND_KEY = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const SECRET_KEY = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const STORAGE_ROOT = "pubky-passport/local-identities/v1";
const GOOGLE_EXPLAINER = "Continue with Google, powered by Pubky Passport.";
const PASSPORT_README = "https://github.com/pubky/pubky-passport/blob/main/README.md";

function centreOf(box: { x: number; y: number; width: number; height: number }) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function seedLocalIdentity(page: Page) {
  await page.addInitScript(
    ({ firstKey, secretKey, storageRoot }) => {
      localStorage.setItem(
        `${storageRoot}/identity/${firstKey}`,
        JSON.stringify({
          v: 1,
          publicKeyZ32: firstKey,
          secretKey,
          googleAccount: {
            googleSubject: "google-First",
            email: "First@example.com",
            name: "First",
            pictureUrl: null,
          },
        }),
      );
      localStorage.setItem(`${storageRoot}/active`, firstKey);
    },
    { firstKey: FIRST_KEY, secretKey: SECRET_KEY, storageRoot: STORAGE_ROOT },
  );
}

test("primary screens have no automated accessibility violations", async ({ page }) => {
  await seedLocalIdentity(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await page.getByRole("button", { name: "Authorize an app" }).click();
  await expect(page.getByRole("heading", { name: "Authorize an app." })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

const REQUEST =
  "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox" +
  "&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-source=Client%20App" +
  "&x-success=https%3A%2F%2Fclient.example%2Fsuccess&x-error=https%3A%2F%2Fclient.example%2Ferror" +
  "&x-cancel=https%3A%2F%2Fclient.example%2Fcancel";

test("a pending sign-in survives the legal links, the logo and a reload the person stops", async ({
  page,
  context,
}) => {
  await seedLocalIdentity(page);
  await page.goto(`/authorize#d=${encodeURIComponent(REQUEST)}`);
  await page
    .getByRole("list", { name: "Choose the identity to sign in with." })
    .getByRole("button")
    .click();
  const authorize = page.getByRole("button", { name: "Authorize", exact: true });
  await expect(authorize).toBeVisible();

  // The logo leads nowhere while a request waits.
  await expect(page.getByRole("img", { name: "Pubky", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pubky", exact: true })).toHaveCount(0);
  // Reading the terms opens a new tab and leaves the request where it was.
  const terms = page.getByRole("link", { name: "Terms of Service (opens in a new tab)" });
  await expect(terms).toHaveAttribute("target", "_blank");
  await expect(
    page.getByRole("link", { name: "Privacy Policy (opens in a new tab)" }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  const [legal] = await Promise.all([context.waitForEvent("page"), terms.click()]);
  await expect(legal).toHaveURL(/\/terms-of-service$/u);
  await legal.close();
  await expect(authorize).toBeVisible();

  // A reload asks first; staying keeps the request, which is never stored and could not return.
  const prompts: string[] = [];
  page.once("dialog", (dialog) => {
    prompts.push(dialog.type());
    void dialog.dismiss();
  });
  await page.reload({ timeout: 2_000 }).catch(() => undefined);
  expect(prompts).toEqual(["beforeunload"]);
  await expect(authorize).toBeVisible();
  await expect(page).toHaveURL(/\/authorize$/u);
});

test("the app closes its own popup mid-request without a leave prompt", async ({
  page,
  context,
}) => {
  await seedLocalIdentity(page);
  await page.goto("/");
  const passportEntry = new URL(`/authorize#d=${encodeURIComponent(REQUEST)}`, page.url()).href;
  await page.route("https://client.example/**", (route) =>
    route.fulfill({ body: "<!doctype html><title>Client</title>", contentType: "text/html" }),
  );
  // The app's page, which opens Passport as its sign-in popup and keeps the handle.
  await page.goto("https://client.example/");
  for (const screen of ["review", "Ring QR code"] as const) {
    const [popup] = await Promise.all([
      context.waitForEvent("page"),
      page.evaluate((url) => {
        (window as unknown as { passport: Window | null }).passport = window.open(
          url,
          "passport",
          "popup,width=520,height=760",
        );
      }, passportEntry),
    ]);
    const prompts: string[] = [];
    popup.on("dialog", (dialog) => {
      prompts.push(dialog.type());
      void dialog.dismiss();
    });
    await expect(popup.getByRole("heading", { name: "Sign in to Client App" })).toBeVisible();
    if (screen === "review") {
      await popup
        .getByRole("list", { name: "Choose the identity to sign in with." })
        .getByRole("button")
        .click();
      await expect(popup.getByRole("button", { name: "Authorize", exact: true })).toBeVisible();
    } else {
      await popup.getByRole("button", { name: "Continue with Pubky Ring", exact: true }).click();
      await expect(popup.getByRole("img", { name: "Pubky authorization QR code" })).toBeVisible();
    }

    // The session arrived through the relay, or the app gave up: it closes the popup itself.
    const closed = popup.waitForEvent("close");
    await page.evaluate(() => (window as unknown as { passport: Window }).passport.close());
    await closed;
    expect(prompts, screen).toEqual([]);
    expect(
      await page.evaluate(() => (window as unknown as { passport: Window }).passport.closed),
    ).toBe(true);
  }
});

test("outside a request the logo leads home and the legal links stay in the tab", async ({
  page,
}) => {
  await page.goto("/privacy-policy");
  await expect(page.getByRole("link", { name: "Pubky", exact: true })).toHaveAttribute("href", "/");
  const terms = page.getByRole("link", { name: "Terms of Service", exact: true });
  await expect(terms).not.toHaveAttribute("target");
  await terms.click();
  await expect(page).toHaveURL(/\/terms-of-service$/u);
});

test("the first paint says Passport is opening before any of its scripts run", async ({ page }) => {
  await page.route("**/_next/static/chunks/*.js", (route) => route.abort());
  await page.goto("/");

  const loading = page.getByRole("main", { name: "Loading Passport" });
  await expect(loading).toBeVisible();
  await expect(loading).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("heading", { level: 1, name: "Loading Passport" })).toBeAttached();
  const message = page.getByText("Opening Passport…", { exact: true });
  await expect(message).toBeVisible();
  // Centred in the window rather than tucked under the header.
  const box = (await message.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(
    viewport.height / 8,
  );
});

test("the first screen renders without loading the Pubky SDK, which comes when needed", async ({
  page,
}) => {
  const scripts: Promise<number>[] = [];
  page.on("response", (response) => {
    if (response.request().resourceType() === "script")
      scripts.push(
        response.body().then(
          (body) => body.byteLength,
          () => 0,
        ),
      );
  });
  // The SDK bundle is well over a megabyte; everything the first screen needs is far smaller.
  const largestScript = async () => Math.max(0, ...(await Promise.all(scripts)));

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(await largestScript()).toBeLessThan(1_000_000);

  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("button", { name: "Enter invite manually" }).click();
  // Checking the invite with its homeserver is the first step that needs the SDK.
  await page.getByLabel("Enter invite code").fill("AB12-CD34-EF56");
  await expect.poll(largestScript, { timeout: 15_000 }).toBeGreaterThan(1_000_000);
});

test("a stale link lands on Passport's own not-found page, with a way back", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle("Page not found | Pubky Passport");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found." })).toBeVisible();
  // Passport's dark page, header and footer, not a white default page inside them.
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(
    "rgb(255, 255, 255)",
  );
  await expect(page.getByRole("main")).toHaveCount(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "Go to Passport" }).click();
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole("heading", { level: 1, name: /Get your pubky/u })).toBeVisible();
});

test("the signer title keeps its accent color without horizontal overflow", async ({ page }) => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    const heading = page.getByRole("heading", { name: "Get your pubky." });
    await expect(heading).toBeVisible();
    const headingColor = await heading.evaluate((element) => getComputedStyle(element).color);
    const [titleBox, accentBox] = await heading.locator("span").evaluateAll((spans) =>
      spans.map((span) => {
        const bounds = span.getBoundingClientRect();
        return {
          color: getComputedStyle(span).color,
          display: getComputedStyle(span).display,
          left: bounds.left,
          top: bounds.top,
        };
      }),
    );

    expect(titleBox).toBeDefined();
    expect(accentBox).toBeDefined();
    expect(titleBox?.color).toBe(headingColor);
    expect(accentBox?.color).toBe("rgb(200, 255, 0)");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  }
});

test("the passport chrome does not overlap content in a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 400 });
  await page.goto("/");

  const logo = page.getByRole("img", { name: "Pubky", exact: true });
  const heading = page.getByRole("heading", { name: "Get your pubky." });
  const footer = page.locator("body > footer");
  const main = page.locator("main");
  await expect(heading).toBeVisible();

  const [logoBox, headingBox, mainBox, footerBox] = await Promise.all([
    logo.boundingBox(),
    heading.boundingBox(),
    main.boundingBox(),
    footer.boundingBox(),
  ]);

  expect(logoBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(mainBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect((logoBox?.y ?? 0) + (logoBox?.height ?? 0)).toBeLessThanOrEqual(headingBox?.y ?? 0);
  expect(await footer.evaluate((element) => getComputedStyle(element).position)).toBe("static");
  expect(footerBox?.y).toBeGreaterThanOrEqual((mainBox?.y ?? 0) + (mainBox?.height ?? 0) - 1);
});

test("brand border utilities override the neutral base border", async ({ page }) => {
  await seedLocalIdentity(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Authorize an app" }).click();

  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeVisible();
  expect(await continueButton.evaluate((element) => getComputedStyle(element).borderColor)).toBe(
    "rgb(200, 255, 0)",
  );
});

test("keys draw an x between two digits as the letter, not as a multiplication sign", async ({
  page,
}) => {
  // z-base-32 keys mix letters and digits; this one contains "9x6" twice.
  const key = "p37b3zjjsn5a9wj46uniud9x6uz1ifaspa6kphzr9x6c5ynomxao";
  await page.goto("/");
  await storeLocalIdentities(page, [{ publicKeyZ32: key }], { active: key });
  await page.reload();
  await page.getByRole("button", { name: "Manage identity" }).click();
  const value = page.getByText(key, { exact: true });
  await expect(value).toBeVisible();
  await page.evaluate(async () => document.fonts.ready);

  const rendering = await value.evaluate((element) => {
    const widthOf = (fontFeatureSettings: string) => {
      const probe = document.createElement("span");
      probe.textContent = "9x6";
      probe.style.fontFeatureSettings = fontFeatureSettings;
      element.append(probe);
      const { width } = probe.getBoundingClientRect();
      probe.remove();
      return width;
    };
    return {
      ligatures: getComputedStyle(element).fontVariantLigatures,
      rendered: widthOf(""),
      withoutAlternates: widthOf('"calt" 0'),
    };
  });
  expect(rendering.ligatures).toBe("no-contextual");
  expect(rendering.rendered).toBe(rendering.withoutAlternates);
});

test("the Google explainer opens inside the window at every desktop width", async ({ page }) => {
  const height = 900;
  for (const width of [768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    const help = page.getByRole("button", { name: "About signing in with Google" });
    await help.click();
    const panel = page.getByRole("dialog", { name: GOOGLE_EXPLAINER });
    await expect(panel).toBeVisible();

    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    // Beside or above the pill the panel is placed only where it fits, so it stays in the window
    // vertically too; below is also the fallback when nothing fits.
    const placement = await panel.locator("..").getAttribute("data-placement");
    expect(box!.y).toBeGreaterThanOrEqual(0);
    if (placement !== "below") expect(box!.y + box!.height).toBeLessThanOrEqual(height);

    await help.focus();
    await page.keyboard.press("Tab");
    const learnMore = panel.getByRole("link", { name: "Learn more" });
    await expect(learnMore).toBeFocused();
    const linkBox = await learnMore.boundingBox();
    expect(linkBox!.x).toBeGreaterThanOrEqual(0);
    expect(linkBox!.x + linkBox!.width).toBeLessThanOrEqual(width);
  }
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`the Google explainer stays open while the pointer crosses the pill to it at ${viewport.width}px`, async ({
    context,
    page,
  }) => {
    await context.route(`${PASSPORT_README}*`, (route) =>
      route.fulfill({ body: "<title>README</title>", contentType: "text/html" }),
    );
    await page.setViewportSize(viewport);
    await page.goto("/");
    const mark = page.getByRole("button", { name: "About signing in with Google" });
    await mark.hover();
    const panel = page.getByRole("dialog", { name: GOOGLE_EXPLAINER });
    await expect(panel).toBeVisible();
    // The regression case: the panel opens on the pill's far side from the mark.
    await expect(panel.locator("..")).toHaveAttribute("data-placement", "left");
    const learnMore = panel.getByRole("link", { name: "Learn more" });
    const from = centreOf((await mark.boundingBox())!);
    const to = centreOf((await learnMore.boundingBox())!);

    // A straight line at about 1px/ms, which leaves the pill well before it reaches the panel.
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 16);
    for (let step = 1; step <= steps; step += 1) {
      await page.mouse.move(
        from.x + ((to.x - from.x) * step) / steps,
        from.y + ((to.y - from.y) * step) / steps,
      );
      await page.waitForTimeout(16);
    }

    await expect(panel).toBeVisible();
    const readme = context.waitForEvent("page");
    await learnMore.click();
    await expect(await readme).toHaveURL(PASSPORT_README);
  });
}

test("a focused text field is outlined, and its actions are outlined on their own", async ({
  page,
}) => {
  await seedLocalIdentity(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Authorize an app" }).click();
  const field = page.getByRole("textbox", { name: "Authorization link" });
  const container = field.locator("..");
  const outline = () =>
    container.evaluate((element) => {
      const style = getComputedStyle(element);
      return `${style.outlineStyle} ${style.outlineWidth}`;
    });

  await field.focus();
  expect(await outline()).toBe("solid 2px");

  // Focus moves to the field's own scan or paste button, which carries the outline instead.
  await page.keyboard.press("Tab");
  const actionFocused = await container.evaluate((element) => {
    const focused = document.activeElement;
    return focused instanceof HTMLButtonElement && element.contains(focused)
      ? getComputedStyle(focused).outlineStyle
      : null;
  });
  expect(actionFocused).toBe("solid");
  expect(await outline()).not.toBe("solid 2px");
});

test("camera denial is contained in an accessible dialog", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () => Promise.reject(new DOMException("Mocked denial", "NotAllowedError")),
      },
    });
  });
  await seedLocalIdentity(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Authorize an app" }).click();
  await page.getByRole("button", { name: /^Scan (?:authorization )?QR code$/u }).click();

  const dialog = page.getByRole("dialog", { name: "Scan QR code" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("Camera access is unavailable");
  expect(
    (await new AxeBuilder({ page }).include("dialog").disableRules("video-caption").analyze())
      .violations,
  ).toEqual([]);
});

test("saved identities stay available when active identity changes across tabs", async ({
  context,
  page,
}) => {
  await page.addInitScript(
    ({ firstKey, secondKey, secretKey, storageRoot }) => {
      const profile = (publicKeyZ32: string, name: string) =>
        JSON.stringify({
          v: 1,
          publicKeyZ32,
          secretKey,
          googleAccount: {
            googleSubject: `google-${name}`,
            email: `${name}@example.com`,
            name,
            pictureUrl: null,
          },
        });
      localStorage.setItem(`${storageRoot}/identity/${firstKey}`, profile(firstKey, "First"));
      localStorage.setItem(`${storageRoot}/identity/${secondKey}`, profile(secondKey, "Second"));
      localStorage.setItem(`${storageRoot}/active`, firstKey);
    },
    {
      firstKey: FIRST_KEY,
      secondKey: SECOND_KEY,
      secretKey: SECRET_KEY,
      storageRoot: STORAGE_ROOT,
    },
  );
  await page.goto("/");
  // Without profile.json the Google name is not shown; the attached email identifies each one.
  await expect(page.getByText("First@example.com", { exact: true })).toBeVisible();
  await expect(page.getByText("Second@example.com", { exact: true })).toHaveCount(0);

  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await otherTab.evaluate(
    ({ storageRoot, secondKey }) => localStorage.setItem(`${storageRoot}/active`, secondKey),
    { storageRoot: STORAGE_ROOT, secondKey: SECOND_KEY },
  );

  await expect(page.getByText("Second@example.com", { exact: true })).toBeVisible();
  await otherTab.close();
});

test("saved identity rows do not overflow mobile or desktop", async ({ page }) => {
  await seedLocalIdentity(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  await page.getByRole("button", { name: "Manage identity" }).click();
  // The account shows in its own section and, as where the key lives, under the profile name.
  const accountRow = page
    .getByRole("region", { name: "Google account" })
    .getByText("First@example.com", { exact: true });
  await expect(accountRow).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Public profile" })
      .getByText("First@example.com", { exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => document.fonts.ready);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(async () => document.fonts.ready);

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
});

test("backup password guidance enforces the twelve-character minimum responsively", async ({
  page,
}) => {
  await seedLocalIdentity(page);

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.getByRole("button", { name: "Manage identity" }).click();
    await page.getByRole("button", { name: "Download recovery file" }).click();

    const password = page.getByLabel("Enter strong password");
    // The message element itself: an error wraps its text beside the alert icon.
    const requirement = page.locator("#backup-password-help");
    const download = page.getByRole("button", { name: "Download recovery file" });
    await expect(password).toHaveAttribute("minlength", "12");
    await expect(password).toHaveAttribute("aria-describedby", "backup-password-help");
    await expect(requirement).toHaveText("Minimum 12 characters.");
    await expect(requirement).toBeVisible();

    const [passwordBox, requirementBox] = await Promise.all([
      password.boundingBox(),
      requirement.boundingBox(),
    ]);
    expect(passwordBox).not.toBeNull();
    expect(requirementBox).not.toBeNull();
    expect(requirementBox?.y).toBeGreaterThanOrEqual(
      (passwordBox?.y ?? 0) + (passwordBox?.height ?? 0),
    );

    // Too short is said once the field is left, not while it is typed.
    await password.fill("12345678901");
    await expect(password).not.toHaveAttribute("aria-invalid", "true");
    await password.blur();
    await expect(password).toHaveAttribute("aria-invalid", "true");
    await expect(requirement).toHaveAttribute("role", "alert");
    await expect(requirement).toHaveText("Too short: use at least 12 characters.");

    await password.fill("123456789012");
    await expect(password).not.toHaveAttribute("aria-invalid", "true");
    await expect(requirement).not.toHaveAttribute("role", "alert");
    // Every new backup's password is typed twice, so a typo cannot lock the file; pressing the
    // download before that says so at the second field.
    await download.click();
    const confirmation = page.getByLabel("Confirm password");
    await expect(confirmation).toBeFocused();
    await expect(confirmation).toHaveAttribute("aria-invalid", "true");
    await confirmation.fill("123456789012");
    await expect(confirmation).not.toHaveAttribute("aria-invalid", "true");
  }
});

test("overview keeps recovery and account actions in a separate management screen", async ({
  page,
}) => {
  await seedLocalIdentity(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Authorize an app" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download recovery file" })).toHaveCount(0);
  await page.getByRole("button", { name: "Manage identity" }).click();
  await expect(page.getByRole("heading", { name: "Manage identity." })).toBeFocused();
  await expect(page.getByRole("button", { name: "Authorize an app" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Download recovery file" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use in Pubky Ring" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Detach from Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeFocused();
});

test("overview pubky is plain text; management copying shows the gray info toast", async ({
  page,
}) => {
  await seedLocalIdentity(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => undefined },
    });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();

  const pubky = page.getByText(FIRST_KEY, { exact: true });
  await expect(pubky).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy Pubky" })).toHaveCount(0);
  await expect(pubky).not.toHaveAttribute("title");
  await pubky.click();
  await expect(page.locator("[data-sonner-toast]")).toHaveCount(0);
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Copy Pubky" }).click();
  const toast = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "Pubky copied to clipboard" });
  await expect(toast).toBeVisible();
  await expect(toast).toHaveAttribute("data-mounted", "true");
  await expect(toast).toHaveAttribute("data-type", "info");
  await expect(toast.locator("[data-title]")).toHaveText("Pubky copied to clipboard");
  await expect(toast.locator("[data-description]")).toHaveText(`${FIRST_KEY.slice(0, 32)}...`);
  const icon = toast.locator("[data-icon] svg");
  await expect(icon).toHaveCount(1);
  await expect(icon).toHaveAttribute("viewBox", "0 0 20 20");
  // Passport's typeface, not the system font Sonner's own stylesheet sets.
  await expect(toast).toHaveCSS("font-family", /Inter Tight/u);

  // Under the 84px header on a phone, so the logo and Log out stay visible and usable.
  await expect
    .poll(
      async () => {
        const box = await toast.boundingBox();
        return (
          box !== null &&
          Math.abs(box.x - 24) <= 1 &&
          Math.abs(box.y - 84) <= 1 &&
          Math.abs(box.width - 327) <= 1
        );
      },
      { timeout: 2_000 },
    )
    .toBe(true);
  const header = await page.getByRole("banner").boundingBox();
  expect(header!.y + header!.height).toBeLessThanOrEqual((await toast.boundingBox())!.y + 1);
});

test("management copy controls align with their values and share a right edge", async ({
  page,
}, testInfo) => {
  await mockPublicProfile(page, { name: "Satoshi Nakamoto" });
  await seedProfileIdentity(page, false);
  await page.getByRole("button", { name: "Manage identity" }).click();
  await expect(page.getByRole("button", { name: "Copy Homeserver" })).toBeEnabled();
  await page.evaluate(async () => document.fonts.ready);
  // 36px buttons, grown to 44px touch targets under a finger.
  const side = (await page.evaluate(() => matchMedia("(pointer: coarse)").matches)) ? 44 : 36;

  for (const width of [1440, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const controls = [];
    for (const name of ["Copy Pubky", "Copy Homeserver"]) {
      const button = page.getByRole("button", { name });
      const geometry = await button.evaluate((element) => {
        const control = element.getBoundingClientRect();
        const value = element.parentElement!.querySelector("p")!.getBoundingClientRect();
        const icon = element.querySelector("img, svg")!.getBoundingClientRect();
        return {
          right: control.right,
          width: control.width,
          height: control.height,
          iconWidth: icon.width,
          iconHeight: icon.height,
          centerOffset: control.y + control.height / 2 - (value.y + value.height / 2),
          gap: control.left - value.right,
        };
      });
      expect(geometry.width).toBe(side);
      expect(geometry.height).toBe(side);
      expect(geometry.iconWidth).toBe(20);
      expect(geometry.iconHeight).toBe(20);
      expect(Math.abs(geometry.centerOffset)).toBeLessThanOrEqual(1);
      expect(geometry.gap).toBe(12);
      controls.push(geometry);
    }
    expect(controls[0]!.right).toBe(controls[1]!.right);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.getByRole("region", { name: "Public profile" }).screenshot({
      path: testInfo.outputPath(`profile-copy-controls-${width}.png`),
    });
  }
});

test("management backup confirms its password, verifies the file and records the check", async ({
  page,
}, testInfo) => {
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page, false);
  await page.getByRole("button", { name: "Manage identity" }).click();
  const keys = page.getByRole("region", { name: "Backup & key access" });
  await expect(keys).toContainText("No backup yet.");
  await keys.getByRole("button", { name: "Download recovery file" }).click();
  await page.getByLabel("Enter strong password").fill("correct horse");
  await page.getByLabel("Confirm password").fill("correct horse");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download recovery file" }).click();
  const backup = await downloadPromise;
  await expect(page.getByRole("heading", { name: "Verify recovery file." })).toBeVisible();
  // Outside a removal, the check may be skipped, but only after the primary action.
  await expect(
    page.getByRole("button", { name: "Skip this check (not recommended)" }),
  ).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("management-backup-verification.png"),
    fullPage: true,
  });
  await page.getByLabel("Recovery file", { exact: true }).setInputFiles((await backup.path())!);
  await page.getByLabel("Recovery file password").fill("wrong password");
  await page.getByRole("button", { name: "Verify recovery file" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "That password doesn’t open this file.",
  );
  await page.getByLabel("Recovery file password").fill("correct horse");
  await page.getByRole("button", { name: "Verify recovery file" }).click();
  await expect(page.getByRole("heading", { name: "Manage identity." })).toBeVisible();
  // The check is remembered: the card says so and leaving is a logout again, not a removal.
  await expect(keys).toContainText("Recovery file checked on");
  await page.getByRole("banner").getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Log out of this identity?" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("You checked a recovery file of this key on");
});
