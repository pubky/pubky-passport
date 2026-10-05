import { E2E_SIGNUP_HOMESERVER } from "./helpers/e2eServer";
import { LOCAL_IDENTITY_STORAGE_ROOT, storeLocalIdentities } from "./helpers/localIdentities";
import { ANY_HTTPS_URL, PKARR_RELAY_HOSTS } from "./helpers/network";
import { expect, test, type Page } from "./helpers/passportTest";
import { mockHomeserverRecords, PROFILE_KEY } from "./helpers/pubkyProfile";
import { RECOVERY_FILE_PASSWORD, recoveryFile } from "./helpers/recoveryFile";

const PASSWORD = RECOVERY_FILE_PASSWORD;

async function importBackup(page: Page, passphrase: string, file = recoveryFile()) {
  await page.getByRole("button", { name: "Import it", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import recovery file." })).toBeVisible();
  await page.getByLabel("Recovery file", { exact: true }).setInputFiles(file);
  await page.getByLabel("Recovery file password").fill(passphrase);
  await page.getByRole("button", { name: "Import recovery file" }).click();
}

async function savedIdentityKeys(page: Page) {
  const keys = await page.evaluate(() => Object.keys(localStorage));
  return keys.filter((key) => key.startsWith(`${LOCAL_IDENTITY_STORAGE_ROOT}/identity/`));
}

test.beforeEach(async ({ page }) => {
  // Decryption and the duplicate check are local; no homeserver or relay is reachable here.
  await page.route(ANY_HTTPS_URL, (route) => route.abort());
});

for (const width of [320, 390]) {
  test(`the picked backup's long name stays inside the page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: "Import it", exact: true }).click();
    const picker = page.getByLabel("Recovery file", { exact: true });
    await picker.setInputFiles(recoveryFile());

    // The field shows the name once, cut short inside its box, instead of a line that overflows.
    const field = page.locator('[data-slot="file-field"]');
    await expect(field).toContainText(`pubky-${PROFILE_KEY}.pkarr`);
    await expect(field).toContainText("Change file");
    await expect(page.getByText(/^Selected /u)).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}

test("backup import reports a wrong password and saves nothing", async ({ page }) => {
  await page.goto("/");
  await importBackup(page, "wrong password");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "That password doesn’t open this recovery file.",
  );
  expect(await savedIdentityKeys(page)).toEqual([]);
});

test("backup import says a picked file that isn't a recovery file is the wrong file", async ({
  page,
}) => {
  await page.goto("/");
  await importBackup(page, PASSWORD, {
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a recovery file"),
  });
  // No password opens it, so the message points at the file rather than a typo.
  const alert = page.getByRole("main").getByRole("alert");
  await expect(alert).toHaveText(
    "This isn’t a recovery file. Choose the file whose name ends in .pkarr.",
  );
  await expect(page.getByLabel("Recovery file", { exact: true })).toBeFocused();
  expect(await savedIdentityKeys(page)).toEqual([]);
});

test("backup import opens files protected by a passphrase shorter than Passport's minimum", async ({
  page,
}) => {
  await page.goto("/");
  await importBackup(page, "pin", recoveryFile("pin"));
  // The file decrypted; only the unreachable relays stop the import, and an unchecked homeserver
  // record is never offered for repair.
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Your recovery file opened, but Passport couldn’t look up which homeserver holds its account.",
    { timeout: 15_000 },
  );
  await expect(page.getByRole("heading", { name: "Homeserver not found." })).toHaveCount(0);
  expect(await savedIdentityKeys(page)).toEqual([]);
});

test("backup import publishes a missing homeserver record only after confirming its homeserver", async ({
  browserName,
  page,
}) => {
  const publications: string[] = [];
  // The relays know no packet for the key, and publishing fails, so nothing can be saved.
  await page.route(ANY_HTTPS_URL, (route) => {
    const request = route.request();
    if (!PKARR_RELAY_HOSTS.has(new URL(request.url()).hostname)) return route.abort();
    if (request.method() === "GET") return route.fulfill({ status: 404 });
    publications.push(request.method());
    return route.abort();
  });
  await page.goto("/");
  await importBackup(page, PASSWORD);
  await expect(page.getByRole("heading", { name: "Homeserver not found." })).toBeVisible({
    timeout: 15_000,
  });
  // The homeserver is named in plain words; its key waits behind Technical details.
  await expect(page.getByText("This Passport’s homeserver", { exact: true })).toBeVisible();
  await expect(page.getByText(E2E_SIGNUP_HOMESERVER, { exact: true })).toBeHidden();
  await page.getByText("Technical details").click();
  await expect(page.getByText(E2E_SIGNUP_HOMESERVER, { exact: true })).toBeVisible();
  expect(publications).toEqual([]);

  await page.getByRole("button", { name: "Reconnect and import" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Passport couldn’t list the homeserver for this account",
  );
  expect(publications).not.toEqual([]);
  expect(await savedIdentityKeys(page)).toEqual([]);

  // Back returns to the form with the file already picked, where the browser can put it back.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import recovery file." })).toBeVisible();
  const picker = page.getByLabel("Recovery file", { exact: true });
  const kept = await picker.evaluate((input: HTMLInputElement) => input.files?.[0]?.name ?? null);
  if (browserName === "chromium") expect(kept).toBe(`pubky-${PROFILE_KEY}.pkarr`);
  if (kept) {
    await expect(page.locator('[data-slot="file-name"]')).toContainText(
      `pubky-${PROFILE_KEY}.pkarr`,
    );
  } else {
    await expect(page.locator('[data-slot="file-field"]')).toContainText("No file chosen");
  }
});

test("backup import reaches whichever homeserver the record names and reports its failed sign-in", async ({
  page,
}) => {
  // No operator lists this homeserver anywhere: the identity's record alone names it, and it
  // answers every request with a 503.
  await mockHomeserverRecords(page, "any-homeserver.example");
  const reached: string[] = [];
  await page.route("https://any-homeserver.example/**", async (route) => {
    reached.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 503, body: "" });
  });
  await page.goto("/");
  await importBackup(page, PASSWORD);

  // The homeserver answered (with an outage), so the import reports that, not a blocked request.
  const alert = page.getByRole("main").getByRole("alert");
  await expect(alert).toContainText(
    "Your recovery file opened, but Passport couldn’t sign in to its account.",
    { timeout: 15_000 },
  );
  await expect(alert).not.toContainText("couldn’t look up which homeserver holds its account");
  expect(reached).toContain("/auth/grant/session");
  expect(await savedIdentityKeys(page)).toEqual([]);
  // The file and password are kept, so trying again is one press.
  const attempts = reached.length;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => reached.length).toBeGreaterThan(attempts);
  await expect(alert).toContainText("couldn’t sign in to its account", { timeout: 15_000 });
});

test("backup import refuses an identity already saved in this browser", async ({ page }) => {
  await page.goto("/");
  await storeLocalIdentities(page, [{ publicKeyZ32: PROFILE_KEY }], { active: PROFILE_KEY });
  await page.reload();
  const saved = await page.evaluate(
    (key) => localStorage.getItem(key),
    `${LOCAL_IDENTITY_STORAGE_ROOT}/identity/${PROFILE_KEY}`,
  );
  await page.getByRole("button", { name: "Switch identity", exact: true }).click();
  await page.getByRole("button", { name: "Add identity" }).click();
  await importBackup(page, PASSWORD);
  const alert = page.getByRole("main").getByRole("alert");
  await expect(alert).toContainText("already saved in this browser");
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      `${LOCAL_IDENTITY_STORAGE_ROOT}/identity/${PROFILE_KEY}`,
    ),
  ).toBe(saved);
  // The saved identity is one press away instead of three screens back.
  await alert.getByRole("button", { name: "Use this identity" }).click();
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
});
