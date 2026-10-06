import { holdHttpsRequests } from "./helpers/network";
import { expect, test, type Page } from "./helpers/passportTest";
import { emulateCoarsePointer } from "./helpers/pointer";
import AxeBuilder from "@axe-core/playwright";
import { E2E_HTTP_RELAY_URL, E2E_SIGNUP_HOMESERVER } from "./helpers/e2eServer";
import { HOMESERVER as TEST_HOMESERVER, mockHomeserverRecords } from "./helpers/pubkyProfile";
import { mockRingNetwork, RING_KEY, ringApproves } from "./helpers/pubkyRing";
import { UNVERIFIED_BAND } from "./helpers/requester";

const HOMEGATE_HOMESERVER = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const LIGHTNING_INVOICE_ID = "550e8400-e29b-41d4-a716-446655440000";
// Manual invites must have the homeserver token form; malformed codes never reach a homeserver.
const MANUAL_INVITE = "AB12-CD34-EF56";
const RING_INVITE = "R1NG-5GNP-QW7X";
const AUTHORIZATION_REQUEST =
  "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-source=Client%20App&x-success=https%3A%2F%2Fclient.example%2Fsuccess&x-error=https%3A%2F%2Fclient.example%2Ferror&x-cancel=https%3A%2F%2Fclient.example%2Fcancel";

test("creates an account inside the root signer experience", async ({ page }) => {
  await page.goto("/");
  // The way to verify is picked on the start page; account creation opens on it.
  await page.getByRole("button", { name: "Enter invite manually" }).click();
  await expect(page.getByRole("heading", { name: "Use an invite." })).toBeVisible();
  await expect(page.getByText(E2E_SIGNUP_HOMESERVER, { exact: true })).toBeVisible();
  await page.getByLabel("Enter invite code").fill(MANUAL_INVITE);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("button", { name: "Keep key in Pubky Ring" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Keep key in this browser/u })).toBeVisible();
});

test("goes on to the profile by itself once Pubky Ring used the invite", async ({ page }) => {
  let used = false;
  const lookups: string[] = [];
  await page.route("**/signup_tokens/**", (route) => {
    const request = route.request();
    lookups.push(`${request.method()} ${new URL(request.url()).pathname}`);
    return route.fulfill({ json: { status: used ? "used" : "valid" } });
  });
  // The test homeserver's record is served, so the lookups reach it.
  await reachDestinationChoiceOnTestHomeserver(page);
  await openRingSignup(page);
  const scanScreen = page.getByRole("heading", { name: "Create your account in Pubky Ring." });
  await expect(scanScreen).toBeVisible();
  const beforeScan = lookups.length;
  // Passport keeps looking the invite up read-only while the code is shown, and stays meanwhile.
  await expect.poll(() => lookups.length, { timeout: 10_000 }).toBeGreaterThan(beforeScan);
  await expect(scanScreen).toBeVisible();
  // Nothing to press meanwhile: Passport goes on by itself.
  await expect(page.getByRole("button", { name: "Continue to profile" })).toHaveCount(0);

  used = true;
  await expect(page.getByRole("heading", { name: "Connect Pubky Ring." })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("Account created in Pubky Ring")).toBeVisible();
  expect(new Set(lookups)).toEqual(new Set(["GET /signup_tokens/SMS1-NV1T-C0DE"]));
});

test("keeps account-signup QR distinct and does not claim Ring success", async ({ page }) => {
  await reachDestinationChoice(page);
  await page.getByRole("button", { name: "Keep key in Pubky Ring" }).click();

  // A computer gets the signup's own QR code at once; a phone its link, and no code.
  const phone = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  if (phone) {
    await expect(page.locator('main a[href^="pubkyauth://direct_signup"]')).toBeVisible();
    await expect(page.getByRole("img", { name: /QR code/u })).toHaveCount(0);
  } else await expect(page.getByRole("img", { name: "Pubky Ring signup QR code" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continue to sign in" })).toHaveCount(0);
  await expect(page.getByText(/Authentication succeeded/u)).toHaveCount(0);
});

test("keeps request context and requires a separate profile approval after Ring signup", async ({
  page,
}) => {
  // Only a phone gets the connection's link, which the spec reads the request from.
  await emulateCoarsePointer(page);
  // An invite for the test homeserver, whose record is served, so Passport sees Ring use it.
  await reachDestinationChoiceOnTestHomeserver(
    page,
    `/authorize#d=${encodeURIComponent(AUTHORIZATION_REQUEST)}`,
  );
  await expect(page.getByRole("complementary", UNVERIFIED_BAND)).toBeVisible();
  await page.getByRole("button", { name: "Keep key in Pubky Ring" }).click();
  await ringUsesInvite(page);

  await expect(page.getByRole("complementary", UNVERIFIED_BAND)).toBeVisible();
  // Passport's own profile request is apart from the app's sign-in request: its own region, its
  // own link, and the app's request is not offered here.
  const profileRequestLink = page
    .getByRole("region", { name: "Pubky Ring profile connection" })
    .getByRole("link", { name: "Open Pubky Ring" });
  await expect(profileRequestLink).toHaveAttribute("href", /^pubkyauth:\/\//);
  await expect(page.getByRole("region", { name: "Sign in with Pubky Ring" })).toHaveCount(0);
  await expect(page.locator(`a[href="${AUTHORIZATION_REQUEST}"]`)).toHaveCount(0);
  const profileRequest = new URL((await profileRequestLink.getAttribute("href"))!);
  expect(profileRequest.href).not.toBe(AUTHORIZATION_REQUEST);
  expect(profileRequest.searchParams.get("caps")?.split(",")).toEqual([
    "/pub/pubky.app/profile.json:w",
    "/pub/pubky.app/files/:w",
    "/pub/pubky.app/blobs/:w",
  ]);
  // Nothing is saved for the identity before it is confirmed; only the verified invite waits, for a
  // reload, until an account owns it.
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([
    "pubky-passport/homegate-signup/v1",
  ]);
  await expect(page.getByRole("heading", { name: /^Signed in to/u })).toHaveCount(0);
  // A phone is offered no code at all, its own or the app's.
  await expect(page.getByRole("button", { name: "Show QR code" })).toHaveCount(0);
  await expect(page.getByRole("img", { name: /QR code/u })).toHaveCount(0);
});

test("the profile grant after a Ring signup on the home page polls only the configured relay", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const refused: string[] = [];
    Object.defineProperty(window, "__refusedConnections", { value: refused });
    document.addEventListener("securitypolicyviolation", (event) => {
      if (event.effectiveDirective === "connect-src") refused.push(event.blockedURI);
    });
  });
  const relayRequests: string[] = [];
  await page.route(`${new URL(E2E_HTTP_RELAY_URL).origin}/**`, async (route) => {
    relayRequests.push(route.request().url());
    await route.fulfill({ status: 404, body: "" });
  });
  await emulateCoarsePointer(page);
  await reachDestinationChoiceOnTestHomeserver(page);
  await page.getByRole("button", { name: "Keep key in Pubky Ring" }).click();
  await ringUsesInvite(page);
  await expect(page).toHaveURL(/\/$/u);

  const profileRequestLink = page
    .getByRole("region", { name: "Pubky Ring profile connection" })
    .locator('a[href^="pubkyauth:"]');
  await expect(profileRequestLink).toHaveAttribute("href", /^pubkyauth:\/\//u);
  const profileRequest = new URL((await profileRequestLink.getAttribute("href"))!);
  expect(profileRequest.searchParams.get("relay")).toBe(E2E_HTTP_RELAY_URL);
  await expect.poll(() => relayRequests.length).toBeGreaterThan(0);
  for (const url of relayRequests) expect(url.startsWith(`${E2E_HTTP_RELAY_URL}/`)).toBe(true);
  // `/`'s connect policy refuses nothing in the signup and grant flow, the invite check included.
  const refused = await page.evaluate(
    () => (window as Window & { __refusedConnections?: string[] }).__refusedConnections ?? [],
  );
  expect(refused).toEqual([]);
});

test("an existing account approving the profile grant after a Ring signup keeps its live profile", async ({
  page,
}) => {
  const net = await mockRingNetwork(page, { profile: { name: "Carol" } });
  // Only a phone gets the connection's link, which the spec reads the request from.
  await emulateCoarsePointer(page);
  await reachDestinationChoiceOnTestHomeserver(page);
  await openRingSignup(page);
  await ringUsesInvite(page);
  const link = page
    .getByRole("region", { name: "Pubky Ring profile connection" })
    .locator('a[href^="pubkyauth:"]');
  await expect(link).toHaveAttribute("href", /^pubkyauth:\/\//u);
  await ringApproves(net, (await link.getAttribute("href"))!);

  // The approving pubky already has a profile, so it is not presented as the new one.
  await expect(
    page.getByRole("heading", { name: "This pubky already has a profile" }),
  ).toBeVisible();
  await expect(page.getByText(RING_KEY, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Yes, it is my new pubky" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add this pubky" }).click();

  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await expect(page.getByText("Carol", { exact: true })).toBeVisible();
  // The pubky just created in Ring was not added, and Passport says so.
  await expect(
    page.getByText(/^The pubky you just created in Pubky Ring is not in Passport yet/u),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Create your/u })).toHaveCount(0);
  expect(net.writes).toEqual([]);
  expect(
    await page.evaluate(
      (key) =>
        JSON.parse(localStorage.getItem(`pubky-passport/local-identities/v1/identity/${key}`)!),
      RING_KEY,
    ),
  ).toEqual({ v: 1, publicKeyZ32: RING_KEY, keySource: "ring" });
});

test("local setup starts with a password-protected backup", async ({ page }) => {
  await reachDestinationChoice(page);
  await page.getByRole("button", { name: /Keep key in this browser/u }).click();

  await expect(page.getByRole("heading", { name: /Protect your key/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download recovery file" })).toBeVisible();
  await expect(page.getByText(/Select and decrypt the backup/u)).toHaveCount(0);

  // Showing a half-typed password neither leaves the field nor calls it too short, and typing
  // goes on where it stopped although the field's type changed.
  const password = page.getByLabel("Enter strong password");
  await password.click();
  await page.keyboard.type("correct ho");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toBeFocused();
  await expect(password).toHaveAttribute("type", "text");
  await page.keyboard.type("rse battery");
  await expect(password).toHaveValue("correct horse battery");
  await expect(password).not.toHaveAttribute("aria-invalid");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

test("Back and reload keep local setup resumable without forcing it", async ({
  page,
}, testInfo) => {
  await page.goto(`/authorize#d=${encodeURIComponent(AUTHORIZATION_REQUEST)}`);
  await page.getByRole("button", { name: "Enter invite manually" }).click();
  await page.getByLabel("Enter invite code").fill(MANUAL_INVITE);
  await page.getByRole("button", { name: "Continue" }).click();
  await inspect("signer-choice");
  await page.getByRole("button", { name: "Keep key in this browser" }).click();
  await expect(page.getByRole("heading", { name: "Protect your key." })).toBeVisible();
  const firstKey = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("pubky-passport/local-account-draft/v1")!)
        .publicKeyZ32 as string,
  );
  expect(firstKey).toBeTruthy();
  // The screen says what is at stake: the key lives only here and nobody can reset the password.
  await expect(page.getByText(/Your key is saved only in this browser/u)).toContainText(
    "Nobody can reset the password",
  );
  await expect(page.getByRole("complementary", UNVERIFIED_BAND)).toBeVisible();
  await inspect("protect-key");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Where should your key live?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep key in Pubky Ring" })).toBeEnabled();
  // Leaving before the invite is submitted forgets the draft; a fresh key is prepared next.
  expect(
    await page.evaluate(() => localStorage.getItem("pubky-passport/local-account-draft/v1")),
  ).toBeNull();
  await page.getByRole("button", { name: "Keep key in this browser" }).click();
  await expect(page.getByRole("heading", { name: "Protect your key." })).toBeVisible();
  const key = await page.evaluate(
    () =>
      JSON.parse(localStorage.getItem("pubky-passport/local-account-draft/v1")!)
        .publicKeyZ32 as string,
  );
  expect(key).not.toBe(firstKey);
  await expect(page.getByRole("button", { name: "Keep key in Pubky Ring" })).toHaveCount(0);
  await page.getByLabel("Enter strong password").fill("correct horse");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download recovery file" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(`pubky-${key}.pkarr`);
  await expect(page.getByRole("heading", { name: "Verify recovery file." })).toBeVisible();
  // Passport cannot see the saved file, so it names the one it started and where to look.
  await expect(page.getByText(/Download started:/u)).toHaveText(
    `Download started: pubky-${key.slice(0, 6)}…${key.slice(-6)}.pkarr. Not in your downloads? Download again`,
  );
  await inspect("verify-backup");
  await page.reload();
  // A reload never forces setup; opening account creation again offers the saved key.
  await expect(page.getByRole("heading", { name: "Verify recovery file." })).toHaveCount(0);
  await resumeSavedSetup(page);
  await expect(page.getByRole("heading", { name: "Verify recovery file." })).toBeVisible();
  // The file may be from days ago, so it is named as such, with a way out if it is lost.
  await expect(page.getByLabel("Recovery file you saved earlier")).toBeAttached();
  await expect(page.getByText(/Can’t find it\?/u)).toContainText(
    `Look for pubky-${key.slice(0, 6)}…${key.slice(-6)}.pkarr.`,
  );
  await page.getByRole("button", { name: "Verify and create account" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Select the recovery file you saved earlier",
  );
  // Skipping needs a download made in this session; after a reload only the file check remains.
  await expect(page.getByRole("button", { name: "Skip this check (not recommended)" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Recovery file password")).toHaveValue("");
  const savedKeys = await page.evaluate(() => Object.keys(localStorage));
  expect(savedKeys.some((entry) => entry.startsWith("pubky-passport/local-identities/"))).toBe(
    false,
  );
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("correct horse");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("pubkyauth://");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Protect your key." })).toBeVisible();
  await page.reload();
  await resumeSavedSetup(page);
  await expect(page.getByRole("heading", { name: "Protect your key." })).toBeVisible();
  // The resumed setup keeps the same key.
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("pubky-passport/local-account-draft/v1")!)
          .publicKeyZ32 as string,
    ),
  ).toBe(key);

  async function inspect(name: string) {
    await page.mouse.move(0, 0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const layout = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      contentBottom: document.querySelector("main")!.getBoundingClientRect().bottom,
      footerTop: document.querySelector("footer")!.getBoundingClientRect().top,
    }));
    expect(layout.width).toBeLessThanOrEqual(layout.viewport);
    expect(layout.footerTop).toBeGreaterThanOrEqual(layout.contentBottom - 1);
    await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: true });
  }
});

test("decrypts the downloaded backup before starting local registration", async ({ page }) => {
  await reachDestinationChoiceOnTestHomeserver(page);
  await page.getByRole("button", { name: /Keep key in this browser/u }).click();

  await page.getByLabel("Enter strong password").fill("correct horse");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download recovery file" }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  expect(backupPath).not.toBeNull();

  await expect(page.getByRole("heading", { name: "Verify recovery file." })).toBeVisible();
  // A file that isn't a recovery file points at the file, not at the password.
  await page.getByLabel("Recovery file", { exact: true }).setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a recovery file"),
  });
  await page.getByLabel("Recovery file password").fill("correct horse");
  await page.getByRole("button", { name: "Verify and create account" }).click();
  await expect(
    page.getByText(/^Select the recovery file you just downloaded, pubky-/u),
  ).toBeVisible();
  await expect(page.getByText(/That password doesn’t open this file/u)).toHaveCount(0);

  await page.getByLabel("Recovery file", { exact: true }).setInputFiles(backupPath!);
  await page.getByLabel("Recovery file password").fill("wrong password");
  await page.getByRole("button", { name: "Verify and create account" }).click();
  await expect(page.getByText(/That password doesn’t open this file/u)).toBeVisible();

  await holdHttpsRequests(page);
  await page.getByLabel("Recovery file password").fill("correct horse");
  await page.getByRole("button", { name: "Verify and create account" }).click();
  await expect(page.getByRole("heading", { name: "Setting up your pubky." })).toBeVisible();
  await expect(page.getByRole("list", { name: "Steps to set up your pubky" })).toBeVisible();
  // The homeserver is named once the account exists, not while it is being set up.
  await expect(page.getByText(TEST_HOMESERVER, { exact: true })).toHaveCount(0);
});

test("SMS validates codes and retains Homegate's homeserver for the destination choice", async ({
  page,
}) => {
  // The Ring signup link carries the invite; only a phone gets it.
  await emulateCoarsePointer(page);
  await page.route("**/sms_verification/send_code", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ phoneNumber: "+41791234567" });
    await route.fulfill({ status: 200, body: "" });
  });
  await page.route("**/sms_verification/validate_code", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      json:
        body.code === "123456"
          ? {
              valid: "true",
              signupCode: "sms-invite-token",
              homeserverPubky: HOMEGATE_HOMESERVER,
            }
          : { valid: "false" },
    });
  });

  await openCreateAccount(page);
  await page.getByRole("button", { name: "Continue with SMS" }).click();
  await page.getByLabel("Phone number", { exact: true }).fill("+41 79 123 45 67");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("000000");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("incorrect");
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify code" }).click();

  await expect(page.getByRole("button", { name: "Keep key in Pubky Ring" })).toBeVisible();
  // The choice names no homeserver; the account-created screen does.
  await expect(page.getByText(HOMEGATE_HOMESERVER, { exact: true })).toHaveCount(0);
  await openRingSignup(page);
  await expect(ringSignupLink(page)).toHaveAttribute(
    "href",
    `pubkyauth://direct_signup?hs=${HOMEGATE_HOMESERVER}&st=sms-invite-token`,
  );
});

test("SMS refuses a sign-up code that names no homeserver instead of guessing one", async ({
  page,
}) => {
  await page.route("**/sms_verification/send_code", (route) =>
    route.fulfill({ status: 200, body: "" }),
  );
  await page.route("**/sms_verification/validate_code", (route) =>
    route.fulfill({ json: { valid: "true", signupCode: "sms-invite-token" } }),
  );
  await openCreateAccount(page);
  await page.getByRole("button", { name: "Continue with SMS" }).click();
  await page.getByLabel("Phone number", { exact: true }).fill("+41791234567");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify code" }).click();

  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "didn’t say which homeserver your account belongs on",
  );
  await expect(page.getByRole("heading", { name: "Where should your key live?" })).toHaveCount(0);
  expect(
    await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes("homegate"))),
  ).toEqual([]);
});

test("SMS provider limits stay recoverable inside account creation", async ({ page }) => {
  await page.route("**/sms_verification/send_code", (route) =>
    route.fulfill({ status: 429, body: "Phone number has exceeded weekly verification limit" }),
  );
  await openCreateAccount(page);
  await page.getByRole("button", { name: "Continue with SMS" }).click();
  await page.getByLabel("Phone number", { exact: true }).fill("+41791234567");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("weekly sign-up limit");
  // The refused number is not sent again, and the other ways are offered right there.
  await expect(page.getByRole("button", { name: "Send code" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Pay with Lightning instead" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use an invite code" })).toBeVisible();
  // Back from the method's first step is the start page, where the other ways are buttons too.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Lightning" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter invite manually" })).toBeVisible();
});

test("SMS Back, Cancel, and reload preserve the verified invite", async ({ page }) => {
  // The Ring signup link carries the invite; only a phone gets it.
  await emulateCoarsePointer(page);
  let sends = 0;
  let verifications = 0;
  await page.route("**/sms_verification/send_code", async (route) => {
    sends++;
    await route.fulfill({ status: 200, body: "" });
  });
  await page.route("**/sms_verification/validate_code", async (route) => {
    verifications++;
    await route.fulfill({
      json: {
        valid: "true",
        signupCode: "verified-sms-invite",
        homeserverPubky: HOMEGATE_HOMESERVER,
      },
    });
  });
  await page.goto(`/authorize#d=${encodeURIComponent(AUTHORIZATION_REQUEST)}`);
  await page.getByRole("button", { name: "Continue with SMS" }).click();
  await page.getByLabel("Phone number", { exact: true }).fill("+41791234567");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Phone number", { exact: true })).toHaveValue("+41791234567");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify code" }).click();
  await page.getByRole("button", { name: "Keep key in this browser" }).click();
  await expect(page.getByRole("heading", { name: "Protect your key." })).toBeVisible();
  const draft = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("pubky-passport/local-account-draft/v1")!),
  );
  expect(draft.signupToken).toBe("verified-sms-invite");
  expect(draft.homeserverPubky).toBe(HOMEGATE_HOMESERVER);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Where should your key live?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep key in Pubky Ring" })).toBeEnabled();
  // The verified invite survives Back inside the flow, but the unregistered key does not.
  expect(
    await page.evaluate(() => localStorage.getItem("pubky-passport/local-account-draft/v1")),
  ).toBeNull();
  await page.getByRole("button", { name: "Keep key in this browser" }).click();
  await expect(page.getByRole("heading", { name: "Protect your key." })).toBeVisible();
  await expect(page.getByText(`Pubky: ${draft.publicKeyZ32}`, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("complementary", UNVERIFIED_BAND)).toHaveCount(1);
  expect(sends).toBe(1);
  expect(verifications).toBe(1);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  // Leaving account creation is Back: Cancel is kept for answering the app's request.
  await expect(page.getByText("Your verification stays saved in this browser.")).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume account setup" })).toHaveCount(0);
  // Back drops the unsubmitted key, but the verified invite reopens without another SMS: picking
  // a way to verify again picks up the saved verification instead.
  await page.getByRole("button", { name: "Continue with SMS" }).click();
  await expect(page.getByRole("heading", { name: "Where should your key live?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep key in Pubky Ring" }).click();
  const ringLink = ringSignupLink(page);
  const ringRequest = new URL((await ringLink.getAttribute("href"))!);
  expect(ringRequest.searchParams.get("st")).toBe("verified-sms-invite");
  expect(ringRequest.searchParams.get("hs")).toBe(HOMEGATE_HOMESERVER);
  expect(
    await page.evaluate(() => localStorage.getItem("pubky-passport/local-account-draft/v1")),
  ).toBeNull();
  await expect(page.getByRole("complementary", UNVERIFIED_BAND)).toHaveCount(1);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain("+41791234567");

  await page.reload();
  await page.getByRole("button", { name: "Continue with SMS" }).click();
  await expect(page.getByRole("heading", { name: "Where should your key live?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep key in Pubky Ring" }).click();
  await expect(ringLink).toHaveAttribute(
    "href",
    `pubkyauth://direct_signup?hs=${HOMEGATE_HOMESERVER}&st=verified-sms-invite`,
  );
  expect(sends).toBe(1);
  expect(verifications).toBe(1);
});

test("manual invite Back returns to the completed form and then the start page", async ({
  page,
}) => {
  await reachDestinationChoice(page);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Enter invite code")).toHaveValue(MANUAL_INVITE);
  // Back from the invite entry leaves account creation: the start page, where it was picked.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Get your pubky." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Create your account." })).toHaveCount(0);
  // Leaving dropped the unsubmitted invite, as leaving account creation always did.
  await page.getByRole("button", { name: "Enter invite manually" }).click();
  await expect(page.getByLabel("Enter invite code")).toHaveValue("");
});

test("shared account creation offers Ring after verification and Back keeps its invite", async ({
  page,
}) => {
  // The Ring signup link carries the invite; only a phone gets it.
  await emulateCoarsePointer(page);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Continue with Pubky Ring", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Create account in Ring", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Enter invite manually" }).click();
  await page.getByLabel("Enter invite code").fill(RING_INVITE);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Where should your key live?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep key in this browser" })).toBeEnabled();
  await page.getByRole("button", { name: "Keep key in Pubky Ring", exact: true }).click();
  const link = ringSignupLink(page);
  const url = `pubkyauth://direct_signup?hs=${E2E_SIGNUP_HOMESERVER}&st=${RING_INVITE}`;
  await expect(link).toHaveAttribute("href", url);
  // Where to get Pubky Ring is on the hand-off itself, not a separate step.
  await expect(
    page.getByRole("link", { name: "Download Pubky Ring on the App Store" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Where should your key live?" })).toBeVisible();
  // Passport stays available; the invite is checked with the homeserver before reuse.
  await expect(page.getByRole("button", { name: "Keep key in this browser" })).toBeEnabled();
  await page.getByRole("button", { name: "Keep key in Pubky Ring", exact: true }).click();
  await expect(link).toHaveAttribute("href", url);
  await expect(page.getByRole("img", { name: "Pubky authorization QR code" })).toHaveCount(0);
});

test("Lightning payment uses the homeserver returned with its token", async ({ page }) => {
  // The Ring signup link carries the invite; only a phone gets it.
  await emulateCoarsePointer(page);
  let paid = false;
  let invoices = 0;
  await page.route("**/ln_verification", (route) => {
    invoices++;
    return route.fulfill({
      json: {
        id: LIGHTNING_INVOICE_ID,
        amountSat: 100,
        expiresAt: Date.now() + 60_000,
        bolt11Invoice: "lnbc100n1example",
      },
    });
  });
  await page.route(`**/ln_verification/${LIGHTNING_INVOICE_ID}`, (route) =>
    route.fulfill({
      json: {
        id: LIGHTNING_INVOICE_ID,
        isPaid: paid,
        signupCode: paid ? "lightning-invite-token" : null,
        homeserverPubky: HOMEGATE_HOMESERVER,
      },
    }),
  );

  await openCreateAccount(page);
  await page.getByRole("button", { name: "Continue with Lightning" }).click();
  // The amount names its unit, so it never reads as bitcoin.
  await expect(page.getByText("100 sats", { exact: true })).toBeVisible();
  await expect(page.getByText("One-time payment to verify your new account.")).toBeVisible();
  await expect(page.locator('a[href^="lightning:"]')).toHaveAttribute(
    "href",
    "lightning:lnbc100n1example",
  );
  paid = true;
  await expect(page.getByRole("button", { name: "Keep key in Pubky Ring" })).toBeVisible({
    timeout: 10_000,
  });
  await openRingSignup(page);
  await expect(ringSignupLink(page)).toHaveAttribute(
    "href",
    `pubkyauth://direct_signup?hs=${HOMEGATE_HOMESERVER}&st=lightning-invite-token`,
  );
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Where should your key live?" })).toBeVisible();
  await openRingSignup(page);
  await expect(ringSignupLink(page)).toHaveAttribute(
    "href",
    `pubkyauth://direct_signup?hs=${HOMEGATE_HOMESERVER}&st=lightning-invite-token`,
  );
  expect(invoices).toBe(1);
});

test("the removed account route returns not found while the authorization entry remains", async ({
  page,
}) => {
  expect((await page.goto("/create-account"))?.status()).toBe(404);
  expect((await page.goto("/authorize"))?.status()).toBe(200);
  // Without a request the entry hands over to `/`.
  await expect(page).toHaveURL(/\/$/u);
  await expect(page.getByRole("region", { name: "Create account" })).toBeVisible();
});

async function reachDestinationChoice(page: Page): Promise<void> {
  await openCreateAccount(page);
  await page.getByRole("button", { name: "Enter invite manually" }).click();
  await page.getByLabel("Enter invite code").fill(MANUAL_INVITE);
  await page.getByRole("button", { name: "Continue" }).click();
}

/**
 * Reaches the signer choice with an SMS invite for the test homeserver, whose signed record the
 * relays serve, so registration contacts only hosts the spec controls.
 */
async function reachDestinationChoiceOnTestHomeserver(page: Page, entry = "/"): Promise<void> {
  await mockHomeserverRecords(page);
  await page.route("**/sms_verification/send_code", (route) =>
    route.fulfill({ status: 200, body: "" }),
  );
  await page.route("**/sms_verification/validate_code", (route) =>
    route.fulfill({
      json: { valid: "true", signupCode: "SMS1-NV1T-C0DE", homeserverPubky: TEST_HOMESERVER },
    }),
  );
  await page.goto(entry);
  await expect(page.getByRole("region", { name: "Create account" })).toBeVisible();
  await page.getByRole("button", { name: "Continue with SMS" }).click();
  await page.getByLabel("Phone number", { exact: true }).fill("+41791234567");
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify code" }).click();
}

/** The start page, where the way to verify a new account is picked. */
async function openCreateAccount(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Create account" })).toBeVisible();
}

async function openRingSignup(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Keep key in Pubky Ring" }).click();
}

/** Ring uses the invite: the next lookup says so, and Passport goes on to the profile by itself. */
async function ringUsesInvite(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Create your account in Pubky Ring." }),
  ).toBeVisible();
  await page.route("**/signup_tokens/**", (route) => route.fulfill({ json: { status: "used" } }));
  await expect(page.getByRole("heading", { name: "Connect Pubky Ring." })).toBeVisible({
    timeout: 15_000,
  });
}

/** The Ring signup's link, which carries the invite; only a phone (coarse pointer) gets it. */
function ringSignupLink(page: Page) {
  return page.getByRole("link", { name: "Continue with Pubky Ring" });
}

test("can skip the backup check and keeps the attempted signup bound to its key", async ({
  page,
}) => {
  await reachDestinationChoiceOnTestHomeserver(page);
  await page.getByRole("button", { name: "Keep key in this browser" }).click();
  // Pressed early, the download says what is missing instead of doing nothing.
  await page.getByRole("button", { name: "Download recovery file" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Enter a password of at least 6 characters.",
  );
  // One password field: the file check below is what catches a typo.
  await expect(page.getByLabel("Confirm password")).toHaveCount(0);
  await page.getByLabel("Enter strong password").fill("correct horse");
  await page.getByRole("button", { name: "Download recovery file" }).click();
  await expect(page.getByRole("heading", { name: "Verify recovery file." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Download again" })).toBeVisible();
  // The invite lookup is answered and the signup stays pending, so the attempt remains in progress.
  await page.route(
    (url) => url.hostname === "homeserver.example" && !url.pathname.startsWith("/signup_tokens/"),
    () => undefined,
  );
  await page.getByRole("button", { name: "Skip this check (not recommended)" }).click();
  await expect(page.getByRole("heading", { name: "Setting up your pubky." })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("pubky-passport/local-account-draft/v1")!)
            .registrationStarted,
      ),
    )
    .toBe(true);
});

/** Picking a way to verify reopens a setup saved from an earlier visit instead. */
async function resumeSavedSetup(page: Page) {
  await page.getByRole("button", { name: "Enter invite manually" }).click();
  await expect(page.getByRole("heading", { name: "Where should your key live?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep key in this browser" }).click();
}

test.describe("in the app's 520x760 popup", () => {
  test.use({ viewport: { width: 520, height: 760 }, hasTouch: false });

  test("Pubky Ring signup keeps its QR code, the store badges and Back in view", async ({
    page,
  }) => {
    await page.goto(`/authorize#d=${encodeURIComponent(AUTHORIZATION_REQUEST)}`);
    await page.getByRole("button", { name: "Enter invite manually" }).click();
    await page.getByLabel("Enter invite code").fill(MANUAL_INVITE);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Keep key in Pubky Ring" }).click();

    await expect(page.getByRole("img", { name: "Pubky Ring signup QR code" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Create your account in Pubky Ring." }),
    ).toBeVisible();
    for (const control of [
      page.getByRole("link", { name: "Get Pubky Ring on Google Play" }),
      page.getByRole("button", { name: "Back", exact: true }),
    ]) {
      const box = (await control.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(760);
    }
  });
});
