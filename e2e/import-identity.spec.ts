import { writeFile } from "node:fs/promises";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request, type TestInfo } from "@playwright/test";
import { Keypair } from "@synonymdev/pubky";

import { APPLE_PORT } from "../playwright.config";

const APPLE_ORIGIN = `http://127.0.0.1:${APPLE_PORT}`;
const STORAGE_ROOT = "pubky-passport/local-identities/v1";
const LINK = "Import it";
const PASSWORD = "e2e-recovery-password";

/** Public BIP39 test vectors, never real phrases. Keys from pubky.app's derivation. */
const KNOWN = {
  phrase: "legal winner thank year wave sausage worth useful legal winner thank yellow",
  secretKeyHex: "878386efb78845b3355bd15ea4d39ef97d179cb712b77d5c12b6be415fffeffe",
  publicKeyZ32: "a53kaica1hg81a3znuj6szbw469h84jpwsg8gifuxgmpujfx8k3y",
};
/** A valid phrase whose key publishes no homeserver in this test. */
const UNPUBLISHED_PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const UNPUBLISHED_PUBLIC_KEY = "aihfhgdfshrj8nz9ofo7khayc1mgcqa4wrrdjahs5tmgo4pna3iy";
const OTHER = {
  publicKeyZ32: "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy",
  secretKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
};
const AUTH_REQUEST = `pubkyauth://signin?caps=${encodeURIComponent("/pub/example.app/:rw")}&relay=${encodeURIComponent("https://relay.example/link/")}&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8`;
const AUTHORIZE_URL = `/authorize#d=${encodeURIComponent(AUTH_REQUEST)}`;

type Seed = { publicKeyZ32: string; secretKey: string };
const KNOWN_SEED: Seed = {
  publicKeyZ32: KNOWN.publicKeyZ32,
  secretKey: Buffer.from(KNOWN.secretKeyHex, "hex").toString("base64url"),
};

/** Stores identities as Passport does for browser-only ones; the last one is active. */
async function seedIdentities(page: Page, seeds: Seed[]) {
  await page.addInitScript(
    ({ root, seeds }) => {
      if (sessionStorage.getItem("e2e-seeded")) return;
      sessionStorage.setItem("e2e-seeded", "1");
      for (const seed of seeds) {
        localStorage.setItem(
          `${root}/identity/${seed.publicKeyZ32}`,
          JSON.stringify({ v: 1, publicKeyZ32: seed.publicKeyZ32, secretKey: seed.secretKey }),
        );
        localStorage.setItem(`${root}/active`, seed.publicKeyZ32);
      }
    },
    { root: STORAGE_ROOT, seeds },
  );
}

/** PKARR relays know none of these keys; every other request is recorded. */
async function installNetwork(page: Page) {
  const requests: Request[] = [];
  page.on("request", (request) => requests.push(request));
  const consoleMessages: string[] = [];
  page.on("console", (message) => consoleMessages.push(message.text()));
  await page.route("https://pkarr.*/**", (route) => route.fulfill({ status: 404 }));
  await page.route("https://relay.example/**", (route) => route.fulfill({ status: 200 }));
  return {
    consoleMessages,
    passportApiCalls: () =>
      requests
        .map((request) => new URL(request.url()))
        .filter((url) => url.hostname === "127.0.0.1" && url.pathname.startsWith("/api/"))
        .map((url) => url.pathname),
    relayPosts: () =>
      requests.filter(
        (request) =>
          request.url().startsWith("https://relay.example/") && request.method() === "POST",
      ),
  };
}

async function recoveryFile(info: TestInfo, name: string, secretKeyHex?: string): Promise<string> {
  const keypair = secretKeyHex
    ? Keypair.fromSecret(new Uint8Array(Buffer.from(secretKeyHex, "hex")))
    : Keypair.random();
  try {
    const path = info.outputPath(name);
    await writeFile(path, keypair.createRecoveryFile(PASSWORD));
    return path;
  } finally {
    keypair.free();
  }
}

async function storedPublicKeys(page: Page): Promise<string[]> {
  return page.evaluate(
    (root) =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith(`${root}/identity/`))
        .map((key) => key.slice(`${root}/identity/`.length))
        .sort(),
    STORAGE_ROOT,
  );
}

async function expectNoPhraseLeak(page: Page, consoleMessages: string[], phrase: string) {
  const words = phrase.split(" ");
  const persisted = await page.evaluate(() =>
    JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
  );
  const visibleUrl = page.url();
  for (const haystack of [persisted, visibleUrl, consoleMessages.join("\n")]) {
    expect(haystack).not.toContain(words.slice(0, 3).join(" "));
    expect(haystack).not.toContain(words.slice(0, 3).join("-"));
  }
  expect(consoleMessages.join("\n")).not.toContain(PASSWORD);
}

async function expectQuietLink(page: Page) {
  const link = page.getByRole("button", { name: LINK });
  await expect(link).toBeVisible();
  await expect(link).toHaveCount(1);
  const notice = page.locator("[data-passport-sign-in-notice]");
  const question = page.locator("[data-passport-import-identity]");
  const [linkBox, noticeBox, pillBox, questionBox] = await Promise.all([
    link.boundingBox(),
    notice.boundingBox(),
    page.getByRole("button", { name: "Continue with Google" }).boundingBox(),
    question.boundingBox(),
  ]);
  expect(linkBox && noticeBox && pillBox && questionBox).toBeTruthy();
  // Above the Terms notice, as one line of small text, far smaller than a provider pill.
  expect(linkBox!.y + linkBox!.height).toBeLessThanOrEqual(noticeBox!.y);
  expect(questionBox!.height).toBeLessThanOrEqual(24);
  expect(linkBox!.height).toBeLessThanOrEqual(24);
  expect(linkBox!.height).toBeLessThan(pillBox!.height / 2);
  // At rest: no pointer over the link and no focus on it (Back from the import choice leaves both).
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const style = await link.evaluate((node) => {
    const computed = getComputedStyle(node);
    return {
      background: computed.backgroundColor,
      fontSize: computed.fontSize,
      radius: Number.parseFloat(computed.borderTopLeftRadius),
      underline: computed.textDecorationLine,
    };
  });
  expect(style.background).toBe("rgba(0, 0, 0, 0)");
  expect(style.fontSize).toBe("14px");
  expect(style.radius).toBeLessThan(8);
  expect(style.underline).toBe("none");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
}

async function openImport(page: Page, method: "Recovery phrase" | "Recovery file") {
  await page.getByRole("button", { name: LINK }).click();
  await expect(page.getByRole("heading", { name: "Import pubky." })).toBeVisible();
  await page.getByRole("button", { name: new RegExp(method, "u") }).click();
  await expect(
    page.getByRole("heading", {
      name: method === "Recovery file" ? "Recovery file." : "Recovery phrase.",
    }),
  ).toBeVisible();
}

async function pastePhrase(page: Page, phrase: string) {
  const first = page.getByRole("textbox", { name: "Word 1", exact: true });
  const last = page.getByRole("textbox", { name: "Word 12", exact: true });
  const words = phrase.split(" ");
  await first.focus();
  // A paste event with line breaks, as copied from a note.
  await first.evaluate((input, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    input.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }),
    );
  }, words.join("\n"));
  // Firefox drops clipboardData from synthetic events; type the phrase into one input instead.
  if ((await last.inputValue()) !== words[11]) await first.fill(phrase);
  await expect(last).toHaveValue(words[11]!);
}

test("the import link sits above the Terms notice on every provider choice, Apple off and on", async ({
  page,
}) => {
  await installNetwork(page);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Continue with Apple" })).toHaveCount(0);
  await expectQuietLink(page);

  await page.goto(`${APPLE_ORIGIN}/`);
  await expect(page.getByRole("button", { name: "Continue with Apple" })).toBeVisible();
  await expectQuietLink(page);

  await page.goto(`${APPLE_ORIGIN}${AUTHORIZE_URL}`);
  await expect(page.getByRole("button", { name: "Continue with Apple" })).toBeVisible();
  await expectQuietLink(page);
});

test("with Apple off, /authorize shows the choice with the import link instead of starting Google", async ({
  page,
}) => {
  await installNetwork(page);
  const google: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://accounts.google.com/")) google.push(request.url());
  });
  page.on("popup", (popup) => google.push(popup.url()));
  await page.goto(AUTHORIZE_URL);
  await expect(page.getByRole("button", { name: "Continue with Apple" })).toHaveCount(0);
  await expectQuietLink(page);
  expect(new URL(page.url()).pathname).toBe("/authorize");

  await page.getByRole("button", { name: LINK }).click();
  await expect(page.getByRole("heading", { name: "Import pubky." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Recovery phrase/u })).toBeVisible();
  await expect(page.getByRole("button", { name: /Recovery file/u })).toBeVisible();
  expect(google).toEqual([]);
});

test("Add identity and Use other identity offer the link too", async ({ page }) => {
  await seedIdentities(page, [OTHER]);
  await installNetwork(page);
  for (const origin of ["", APPLE_ORIGIN]) {
    await page.goto(`${origin}/`);
    await page.getByRole("button", { name: "Switch" }).click();
    await page.getByRole("button", { name: "Add identity" }).click();
    await expectQuietLink(page);
  }
  for (const origin of ["", APPLE_ORIGIN]) {
    await page.goto(`${origin}${AUTHORIZE_URL}`);
    await page.getByRole("button", { name: "Switch" }).click();
    await page.getByRole("button", { name: "Use other identity" }).click();
    await expectQuietLink(page);
  }
});

test("recovery file on the start page: wrong file, wrong password, no homeserver", async ({
  page,
}, info) => {
  const network = await installNetwork(page);
  const unpublished = await recoveryFile(info, "unpublished.pkarr");
  const wrongType = info.outputPath("notes.txt");
  await writeFile(wrongType, "not a recovery file");
  const notRecovery = info.outputPath("not-recovery.pkarr");
  await writeFile(notRecovery, "pubky.org/other\nxxxxxxxxxxxxxxxxxxxxxxxx");

  await page.goto(`${APPLE_ORIGIN}/`);
  await openImport(page, "Recovery file");
  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);
  const fileInput = page.locator("input[type=file]");
  await expect(fileInput).toHaveAttribute("accept", ".pkarr");
  const restore = page.getByRole("button", { name: "Restore" });
  const password = page.getByLabel("Enter password");

  await fileInput.setInputFiles(wrongType);
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Please select a .pkarr file.",
  );
  await expect(restore).toBeDisabled();

  await fileInput.setInputFiles(notRecovery);
  await password.fill(PASSWORD);
  await restore.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "This file is not a recovery file. Please select a .pkarr file.",
  );

  await fileInput.setInputFiles(unpublished);
  await password.fill("not-the-password");
  await restore.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Invalid password or corrupted file. Please check your password and try again.",
  );

  await password.fill(PASSWORD);
  await password.press("Enter");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "This pubky has no homeserver, so Passport cannot sign in with it. Nothing was saved.",
    { timeout: 30_000 },
  );
  await expect(page.getByText("Pubky", { exact: true })).toBeVisible();

  expect(await storedPublicKeys(page)).toEqual([]);
  expect(network.passportApiCalls()).toEqual([]);
  expect(network.consoleMessages.join("\n")).not.toContain(PASSWORD);
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.getByRole("heading", { name: "Quick access." })).toBeVisible();
});

test("recovery file of an identity already here: selected, not duplicated", async ({
  page,
}, info) => {
  await seedIdentities(page, [KNOWN_SEED, OTHER]);
  const network = await installNetwork(page);
  const known = await recoveryFile(info, "known.pkarr", KNOWN.secretKeyHex);

  await page.goto("/");
  await expect(page.getByText(OTHER.publicKeyZ32)).toBeVisible();
  await page.getByRole("button", { name: "Switch" }).click();
  await page.getByRole("button", { name: "Add identity" }).click();
  await openImport(page, "Recovery file");
  await page.locator("input[type=file]").setInputFiles(known);
  await page.getByLabel("Enter password").fill(PASSWORD);
  await page.getByRole("button", { name: "Restore" }).click();

  await expect(page.getByRole("heading", { name: "Pubky imported." })).toBeVisible();
  await expect(
    page.getByText("This pubky was already in this browser. Passport switched to it."),
  ).toBeVisible();
  await expect(page.getByText(KNOWN.publicKeyZ32)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await expect(page.getByText(KNOWN.publicKeyZ32)).toBeVisible();
  expect(await storedPublicKeys(page)).toEqual([KNOWN.publicKeyZ32, OTHER.publicKeyZ32].sort());
  expect(network.passportApiCalls()).toEqual([]);
});

test("recovery phrase on /authorize: word checks, bad checksum, no homeserver", async ({
  page,
}) => {
  const network = await installNetwork(page);
  await page.goto(`${APPLE_ORIGIN}${AUTHORIZE_URL}`);
  const urlBefore = page.url();
  await openImport(page, "Recovery phrase");
  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);
  await expect(page.locator("main form")).toHaveCount(0);
  const restore = page.getByRole("button", { name: "Restore" });
  await expect(restore).toBeDisabled();

  const first = page.getByRole("textbox", { name: "Word 1", exact: true });
  await first.pressSequentially("pubky ");
  await expect(page.getByRole("textbox", { name: "Word 2", exact: true })).toBeFocused();
  await expect(first).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Invalid words detected. Check the spelling of the marked words.",
  );

  // Every word valid, two swapped: the checksum fails.
  const words = KNOWN.phrase.split(" ");
  await pastePhrase(page, [words[1], words[0], ...words.slice(2)].join(" "));
  await expect(first).not.toHaveAttribute("aria-invalid");
  await restore.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "This recovery phrase is not valid. Check the words and their order.",
  );

  await pastePhrase(page, UNPUBLISHED_PHRASE);
  await restore.click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "This pubky has no homeserver, so Passport cannot sign in with it. Nothing was saved.",
    { timeout: 30_000 },
  );
  await expect(page.getByText(UNPUBLISHED_PUBLIC_KEY)).toBeVisible();

  expect(page.url()).toBe(urlBefore);
  expect(await storedPublicKeys(page)).toEqual([]);
  expect(network.passportApiCalls()).toEqual([]);
  expect(network.relayPosts()).toEqual([]);
  await expectNoPhraseLeak(page, network.consoleMessages, UNPUBLISHED_PHRASE);
  await expectNoPhraseLeak(page, network.consoleMessages, KNOWN.phrase);
});

test("/authorize Use other identity: phrase of a stored identity returns to review, Authorize stays explicit", async ({
  page,
}) => {
  await seedIdentities(page, [KNOWN_SEED, OTHER]);
  const network = await installNetwork(page);
  await page.goto(`${APPLE_ORIGIN}${AUTHORIZE_URL}`);
  await expect(page.getByText("1AEH...DWDY")).toBeVisible();
  await page.getByRole("button", { name: "Switch" }).click();
  await page.getByRole("button", { name: "Use other identity" }).click();
  await openImport(page, "Recovery phrase");
  await pastePhrase(page, KNOWN.phrase);
  await page.getByRole("button", { name: "Restore" }).click();

  await expect(page.getByRole("heading", { name: "Pubky imported." })).toBeVisible();
  await expect(page.getByText(KNOWN.publicKeyZ32)).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();

  const authorize = page.getByRole("button", { name: "Authorize", exact: true });
  await expect(authorize).toBeEnabled();
  await expect(page.getByText("A53K...8K3Y")).toBeVisible();
  // The review waits for the explicit click: nothing was sent to the app's relay.
  await page.waitForTimeout(500);
  expect(network.relayPosts()).toEqual([]);
  expect(network.passportApiCalls()).toEqual([]);
  await expectNoPhraseLeak(page, network.consoleMessages, KNOWN.phrase);
});
