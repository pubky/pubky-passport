import { Keypair } from "@synonymdev/pubky";

import { E2E_SIGNUP_HOMESERVER } from "./helpers/e2eServer";
import { LOCAL_IDENTITY_STORAGE_ROOT, storeLocalIdentities } from "./helpers/localIdentities";
import { ANY_HTTPS_URL, PKARR_RELAY_HOSTS } from "./helpers/network";
import { expect, test, type Page } from "./helpers/passportTest";
import { mockHomeserverRecords, PROFILE_KEY } from "./helpers/pubkyProfile";

const PASSWORD = "correct horse battery";

/** A real SDK recovery file for `PROFILE_KEY`, built the way other Pubky tools build them. */
function recoveryFile(passphrase = PASSWORD) {
  const keypair = Keypair.fromSecret(new Uint8Array(32).fill(1));
  try {
    return {
      name: `pubky-${PROFILE_KEY}.pkarr`,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(keypair.createRecoveryFile(passphrase)),
    };
  } finally {
    keypair.free();
  }
}

async function importBackup(page: Page, passphrase: string, file = recoveryFile()) {
  await page.getByRole("button", { name: "Import backup", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import backup." })).toBeVisible();
  await page.getByLabel("Pubky backup").setInputFiles(file);
  await page.getByLabel("Backup password").fill(passphrase);
  await page.getByRole("button", { name: "Import backup", exact: true }).click();
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
    await page.getByRole("button", { name: "Import backup", exact: true }).click();
    const picker = page.getByLabel("Pubky backup");
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
  await expect(page.getByRole("main").getByRole("alert")).toContainText("password is wrong");
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
    "The backup decrypted, but its Pubky account could not be verified. Passport could not look up its homeserver record",
    { timeout: 15_000 },
  );
  await expect(page.getByRole("heading", { name: "Homeserver record missing." })).toHaveCount(0);
  expect(await savedIdentityKeys(page)).toEqual([]);
});

test("backup import publishes a missing homeserver record only after confirming its homeserver", async ({
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
  await expect(page.getByRole("heading", { name: "Homeserver record missing." })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText(E2E_SIGNUP_HOMESERVER, { exact: true })).toBeVisible();
  expect(publications).toEqual([]);

  await page.getByRole("button", { name: "Publish record and import" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "could not publish the homeserver record",
  );
  expect(publications).not.toEqual([]);
  expect(await savedIdentityKeys(page)).toEqual([]);
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
    "The backup decrypted, but its Pubky account could not be verified.",
    { timeout: 15_000 },
  );
  await expect(alert).not.toContainText("could not look up its homeserver record");
  expect(reached).toContain("/auth/grant/session");
  expect(await savedIdentityKeys(page)).toEqual([]);
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
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "already saved in this browser",
  );
  expect(
    await page.evaluate(
      (key) => localStorage.getItem(key),
      `${LOCAL_IDENTITY_STORAGE_ROOT}/identity/${PROFILE_KEY}`,
    ),
  ).toBe(saved);
});
