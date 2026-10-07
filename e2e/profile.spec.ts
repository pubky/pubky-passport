import AxeBuilder from "@axe-core/playwright";
import { storeLocalIdentities } from "./helpers/localIdentities";
import { PKARR_RELAY_HOSTS } from "./helpers/network";
import { expect, test, type Page } from "./helpers/passportTest";
import {
  HOMESERVER,
  homeserverRecord,
  mockPublicProfile,
  seedProfileIdentity,
  IDENTITY_STORAGE_KEY,
  PROFILE_KEY,
} from "./helpers/pubkyProfile";

/** A link's address field, by the label its row shows ("Website", or the one it was added with). */
function linkField(page: Page, label: string) {
  return page.getByLabel(label, { exact: true });
}

/** Adds a link through the Add link dialog: its label, its address, then Save Link. */
async function addLink(page: Page, label: string, url: string) {
  await page.getByRole("button", { name: "Add link" }).click();
  const dialog = page.getByRole("dialog", { name: "Add link" });
  await dialog.getByLabel("Label", { exact: true }).fill(label);
  await dialog.getByLabel("URL", { exact: true }).fill(url);
  await dialog.getByRole("button", { name: "Save Link" }).click();
  await expect(dialog).toBeHidden();
}

/** Picks the avatar fixture and takes the crop dialog's square as it opens. */
async function chooseAvatar(page: Page) {
  await page.getByLabel("Choose avatar file").setInputFiles("e2e/fixtures/profile-avatar.png");
  const crop = page.getByRole("dialog", { name: "Crop your avatar" });
  await crop.getByRole("button", { name: "Use photo" }).click();
  await expect(crop).toBeHidden();
}

/** pubky.app's random names: an adjective and two different nouns ("Blue-Rabbit-Hat"). */
const RANDOM_NAME = /^[A-Z][a-z]+-[A-Z][a-z]+-[A-Z][a-z]+$/u;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The identity's homeserver, which takes a profile publish: PKARR relays serve its record, the
 * local key's grant is exchanged for a session, and every write is kept by its `/pub/` path and
 * served back to later reads.
 */
async function mockWritableHomeserver(page: Page) {
  const written = new Map<string, Buffer>();
  await page.route(/^https:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (PKARR_RELAY_HOSTS.has(url.hostname)) {
      if (request.method() !== "GET") return route.fulfill({ status: 204, body: "" });
      const body = homeserverRecord(url.pathname.slice(1));
      return route.fulfill(
        body ? { status: 200, body, contentType: "application/octet-stream" } : { status: 404 },
      );
    }
    if (url.hostname !== "homeserver.example") return route.abort();
    if (url.pathname === "/auth/grant/session" && request.method() === "POST")
      return route.fulfill({ json: sessionFor(request.postDataJSON() as { grant: string }) });
    const path = url.pathname.slice(Math.max(0, url.pathname.indexOf("/pub/")));
    if (request.method() === "PUT") {
      written.set(path, request.postDataBuffer() ?? Buffer.alloc(0));
      return route.fulfill({ status: 200, body: "" });
    }
    const stored = written.get(path);
    if (request.method() === "GET" && stored)
      return route.fulfill({ status: 200, body: stored, contentType: "application/octet-stream" });
    return route.fulfill({ status: request.method() === "GET" ? 404 : 200, body: "" });
  });
  return {
    /** The published `profile.json`, once written. */
    profile: () => {
      const body = written.get("/pub/pubky.app/profile.json");
      return body ? (JSON.parse(body.toString("utf8")) as Record<string, unknown>) : undefined;
    },
    /** Every avatar blob written. */
    blobs: () =>
      [...written].filter(([path]) => path.startsWith("/pub/pubky.app/blobs/")).map(([, b]) => b),
  };
}

/** The homeserver's answer to a grant exchange: a session for exactly what the grant names. */
function sessionFor({ grant }: { grant: string }) {
  const claims = JSON.parse(Buffer.from(grant.split(".")[1]!, "base64url").toString("utf8")) as {
    iss: string;
    client_id: string;
    caps: string[];
    jti: string;
    exp: number;
  };
  const now = Math.floor(Date.now() / 1000);
  return {
    token: "e2e-bearer",
    session: {
      homeserver: HOMESERVER,
      pubky: claims.iss,
      client_id: claims.client_id,
      capabilities: claims.caps,
      grant_id: claims.jti,
      token_expires_at: now + 3_600,
      grant_expires_at: claims.exp,
      created_at: now,
    },
  };
}

const PROFILE = {
  name: "Satoshi",
  bio: "Authored the Bitcoin white paper, developed Bitcoin, mined 1st block.",
  links: [
    { title: "Website", url: "https://www.bitcoin.org/" },
    { title: "X (Twitter)", url: "https://x.com/satoshi" },
  ],
  image: null,
  status: null,
};

test("profile setup follows Figma, preserves identity on reload and failed saves", async ({
  page,
}, info) => {
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page);
  // Setup is asked for right after creation only; afterwards the overview offers it.
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await page.getByRole("button", { name: "Set up profile" }).click();
  await expect(page.getByRole("heading", { name: "Create your profile." })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("profile-empty.png"), fullPage: true });
  await expect(page.getByRole("heading", { name: "Create your profile." })).toBeFocused();
  // Account creation's last step, named in the header row.
  await expect(page.getByRole("navigation", { name: "Account setup progress" })).toContainText(
    "Step 3 of 3: Profile",
  );
  // Nothing is published yet, so a random name starts the profile.
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(RANDOM_NAME);
  await page.getByLabel("Name", { exact: true }).fill(PROFILE.name);
  await page.getByLabel("Bio", { exact: true }).fill(PROFILE.bio);
  await page.getByLabel("Website", { exact: true }).fill(PROFILE.links[0]!.url);
  await page.getByLabel("X (Twitter)", { exact: true }).fill("@satoshi");
  await chooseAvatar(page);
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Your avatar" })).toHaveAttribute("src", /^blob:/);
  await page.screenshot({ path: info.outputPath("profile-filled.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // Back leaves setup for the overview, never for a backup detour, once the unpublished
  // entries are knowingly thrown away.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Discard your changes?" })).toBeVisible();
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose backup method" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeFocused();
  await page.getByRole("button", { name: "Set up profile" }).click();
  await page.getByLabel("Name", { exact: true }).fill(PROFILE.name);
  await chooseAvatar(page);
  // The avatar is re-encoded in the browser, then the homeserver answers the session with a 503.
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Could not save your profile",
    {
      timeout: 15000,
    },
  );
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).profileSetupRequired,
      IDENTITY_STORAGE_KEY,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your pubky." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Set up profile" })).toBeVisible();
});

test("marks each invalid field where it is, with the limits shown before saving", async ({
  page,
}) => {
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page);
  // Setup is offered from the overview once the identity exists.
  await page.getByRole("button", { name: "Set up profile" }).click();
  const writes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "homeserver.example" && request.method() !== "GET")
      writes.push(`${request.method()} ${request.url()}`);
  });
  const name = page.getByLabel("Name", { exact: true });
  const bio = page.getByLabel("Bio", { exact: true });
  const website = page.getByLabel("Website", { exact: true });
  // The field is filled with a random name, and says only its limits.
  await expect(name).toHaveValue(RANDOM_NAME);
  await expect(name).toHaveAccessibleDescription("3–50 characters. Shown publicly.");
  await expect(bio).toHaveAccessibleDescription("0 of 160 characters");
  // Enter submits from the invalid Name field itself, where focus already is, so the form's status
  // says why nothing was saved.
  const refusal = page.locator("form").filter({ has: name }).getByRole("status");
  await name.fill("Al");
  await expect(name).toHaveAccessibleDescription("3–50 characters. Shown publicly.");
  await name.press("Enter");
  await expect(refusal).toHaveText(
    "1 field needs a change. Name: Enter a name of 3–50 characters.",
  );
  await expect(name).toBeFocused();
  await name.fill("");
  await bio.fill("b".repeat(161));
  await expect(page.getByText("161/160")).toBeVisible();
  await website.fill("my website");
  // The dialog wants a label and an address; whether the address is one is judged on saving.
  await addLink(page, "GitHub", "my github");

  // The popup: Continue sits far below the Name field it has to point back to.
  await page.setViewportSize({ width: 520, height: 760 });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(name).toBeFocused();
  await expect(refusal).toHaveText("4 fields need changes. Name: Enter a name of 3–50 characters.");
  await expect(name).toBeInViewport({ ratio: 1 });
  await expect(
    page.getByText("Enter a name of 3–50 characters.", { exact: true }),
  ).toBeInViewport();
  // No browser bubble: the page's own message describes the field.
  expect(await name.evaluate((input: HTMLInputElement) => input.validationMessage)).toBe("");
  for (const [control, message] of [
    [name, "Enter a name of 3–50 characters."],
    [bio, "Keep your bio to 160 characters (you have 161)."],
    [
      website,
      "Enter a full address with its scheme, like https://example.com or mailto:you@example.com.",
    ],
    [
      linkField(page, "GitHub"),
      "Enter a full address with its scheme, like https://example.com or mailto:you@example.com.",
    ],
  ] as const) {
    await expect(control).toHaveAttribute("aria-invalid", "true");
    await expect(control).toHaveAccessibleDescription(message);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  await name.fill("Satoshi");
  await expect(name).not.toHaveAttribute("aria-invalid");
  await bio.fill("Bitcoin");
  await website.fill("https://bitcoin.org");
  await linkField(page, "GitHub").fill("https://github.com/satoshi");
  expect(writes).toEqual([]);
  // Every field passes, so the save runs and meets the unavailable homeserver.
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Could not save your profile",
    { timeout: 15000 },
  );
  await expect(refusal).toBeEmpty();
});

test("flags a name taken from Google, whose field says it is public before it is filled in", async ({
  page,
}) => {
  await page.setViewportSize({ width: 520, height: 760 });
  await mockPublicProfile(page, null);
  await page.goto("/terms-of-service");
  await storeLocalIdentities(
    page,
    [
      {
        publicKeyZ32: PROFILE_KEY,
        googleAccount: {
          googleSubject: "google-1",
          name: "Alice Example",
          email: "alice@example.com",
          pictureUrl: null,
        },
        profileSetupRequired: true,
      },
    ],
    { active: PROFILE_KEY },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Set up profile" }).click();
  const name = page.getByLabel("Name", { exact: true });
  await expect(name).toHaveValue("Alice Example");
  // The field itself says the name is public, in the popup's first screenful, before anything is
  // filled in or published; no separate note repeats it.
  await expect(page.locator("#profile-name-hint")).toHaveText("3–50 characters. Shown publicly.");
  await expect(page.locator("#profile-name-hint")).toBeInViewport();
  await expect(page.getByText(/Anyone can see your profile/u)).toHaveCount(0);
  await expect(name).toHaveAccessibleDescription(
    "From your Google account. Change it if you don’t want it public. 3–50 characters. Shown publicly.",
  );
  await name.fill("Alice");
  await expect(name).toHaveAccessibleDescription("3–50 characters. Shown publicly.");
});

test("refuses a damaged avatar as soon as it is picked, in its crop or beside the picker", async ({
  page,
}) => {
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page);
  await page.getByRole("button", { name: "Set up profile" }).click();
  const picker = page.getByLabel("Choose avatar file");
  await expect(picker).toHaveAccessibleDescription("PNG, JPEG, WebP, or GIF, up to 5 MB.");
  // An image type and name over bytes no browser can decode: the crop that opens says so, and
  // there is nothing to use.
  await picker.setInputFiles({
    name: "holiday.png",
    mimeType: "image/png",
    buffer: Buffer.from("this is not really a png image"),
  });
  const crop = page.getByRole("dialog", { name: "Crop your avatar" });
  await expect(crop.getByRole("alert")).toHaveText(
    "This image can’t be opened. Choose a PNG, JPEG, WebP, or GIF image up to 5 MB.",
  );
  await expect(crop.getByRole("button", { name: "Use photo" })).toBeDisabled();
  await crop.getByRole("button", { name: "Cancel" }).click();
  await expect(crop).toBeHidden();
  // The placeholder stays, with nothing to delete.
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toHaveCount(0);
  await expect(page.getByRole("img", { name: "Your avatar" })).toHaveCount(0);

  // A file that is no image at all never reaches the crop: the picker says why, beside it.
  await picker.setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not an image"),
  });
  const message = page.getByRole("region", { name: "Avatar" }).getByRole("alert");
  await expect(message).toHaveText("Choose a PNG, JPEG, WebP, or GIF image up to 5 MB.");
  await expect(picker).toHaveAccessibleDescription(
    "Choose a PNG, JPEG, WebP, or GIF image up to 5 MB.",
  );
  await expect(crop).toBeHidden();

  await chooseAvatar(page);
  await expect(page.getByRole("img", { name: "Your avatar" })).toHaveAttribute("src", /^blob:/);
  await expect(message).toHaveCount(0);
});

test("Add link asks for a label and an address, and the link is published with its label", async ({
  page,
}) => {
  const homeserver = await mockWritableHomeserver(page);
  await seedProfileIdentity(page);
  await page.getByRole("button", { name: "Set up profile" }).click();
  await page.getByLabel("Name", { exact: true }).fill(PROFILE.name);

  await page.getByRole("button", { name: "Add link" }).click();
  const dialog = page.getByRole("dialog", { name: "Add link" });
  const label = dialog.getByLabel("Label", { exact: true });
  const url = dialog.getByLabel("URL", { exact: true });
  // Both are needed before the link joins the form.
  await dialog.getByRole("button", { name: "Save Link" }).click();
  await expect(label).toHaveAccessibleDescription("Give this link a label.");
  await expect(url).toHaveAccessibleDescription(
    "Enter a full address with its scheme, like https://example.com or mailto:you@example.com.",
  );
  expect((await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations).toEqual([]);
  await label.fill("GitHub");
  await url.fill("https://github.com/satoshi");
  await dialog.getByRole("button", { name: "Save Link" }).click();
  await expect(dialog).toBeHidden();
  // The new row is its label over its address, and it can be removed again.
  await expect(linkField(page, "GitHub")).toHaveValue("https://github.com/satoshi");
  await expect(page.getByRole("button", { name: "Remove GitHub" })).toBeVisible();

  // Cancel adds nothing, and the next link starts from empty fields.
  await page.getByRole("button", { name: "Add link" }).click();
  await expect(label).toHaveValue("");
  await label.fill("Blog");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(linkField(page, "Blog")).toHaveCount(0);

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  // Published as typed, under its label; the empty Website and X rows are left out.
  await expect
    .poll(() => homeserver.profile(), { timeout: 15_000 })
    .toMatchObject({
      name: PROFILE.name,
      links: [{ title: "GitHub", url: "https://github.com/satoshi" }],
    });
});

test("a chosen avatar is cropped first, and Use photo uploads the cropped square", async ({
  page,
}) => {
  const homeserver = await mockWritableHomeserver(page);
  await seedProfileIdentity(page);
  await page.getByRole("button", { name: "Set up profile" }).click();
  await page.getByLabel("Name", { exact: true }).fill(PROFILE.name);

  // The 96px fixture opens in the crop, and nothing is the avatar until Use photo.
  await page.getByLabel("Choose avatar file").setInputFiles("e2e/fixtures/profile-avatar.png");
  const crop = page.getByRole("dialog", { name: "Crop your avatar" });
  await expect(crop).toBeVisible();
  await expect(page.getByRole("img", { name: "Your avatar" })).toHaveCount(0);
  const zoom = crop.getByRole("slider", { name: "Zoom" });
  await expect(zoom).toHaveValue("1");
  await zoom.fill("2");
  await expect(zoom).toHaveValue("2");
  expect((await new AxeBuilder({ page }).include("dialog[open]").analyze()).violations).toEqual([]);
  await crop.getByRole("button", { name: "Use photo" }).click();
  await expect(crop).toBeHidden();
  await expect(page.getByRole("img", { name: "Your avatar" })).toHaveAttribute("src", /^blob:/);
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect
    .poll(() => homeserver.profile(), { timeout: 15_000 })
    .toMatchObject({
      name: PROFILE.name,
      image: expect.stringMatching(
        new RegExp(`^pubky://${PROFILE_KEY}/pub/pubky\\.app/files/`, "u"),
      ),
    });
  // What was uploaded is the crop, a 512px square PNG, not the 96px file that was chosen.
  const [avatar, ...others] = homeserver.blobs();
  expect(others).toEqual([]);
  expect(avatar!.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  expect([avatar!.readUInt32BE(16), avatar!.readUInt32BE(20)]).toEqual([512, 512]);
});

test("an unreadable published profile opens a fresh editor instead of blocking setup", async ({
  page,
}) => {
  await mockPublicProfile(page, { name: "x" });
  await seedProfileIdentity(page);
  await page.getByRole("button", { name: "Set up profile" }).click();
  await expect(page.getByRole("heading", { name: "Create your profile." })).toBeVisible();
  await expect(page.getByText("We couldn’t read your current profile.")).toBeVisible();
  // Nothing of the unreadable profile is kept, and no random name either: saving replaces a
  // profile that is still published, so the name is the person's to give.
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
  await expect(page.getByText("A random name.", { exact: false })).toHaveCount(0);
  // Saving replaces the profile other apps show, so the button says so.
  await expect(page.getByRole("button", { name: "Replace profile", exact: true })).toBeEnabled();
});

test("existing profile names appear across identity screens and profile editing", async ({
  page,
}, info) => {
  await mockPublicProfile(page, {
    ...PROFILE,
    image: `pubky://${PROFILE_KEY}/pub/pubky.app/files/AVATAR`,
  });
  await seedProfileIdentity(page, false);
  await expect(page.getByRole("heading", { name: "Satoshi", exact: true })).toBeVisible();
  await expect(page.locator('main img[src^="blob:"]')).toBeVisible();
  expect(
    await page
      .locator('main img[src^="blob:"]')
      .evaluate((image: HTMLImageElement) => image.naturalWidth),
  ).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Switch identity" }).click();
  await expect(page.getByRole("button", { name: /Satoshi/ })).toBeVisible();
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Manage identity" }).click();
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Satoshi");
  await page.screenshot({ path: info.outputPath("profile-existing.png"), fullPage: true });
});

test("profile form stays accessible in narrow and short windows with five links", async ({
  page,
}, info) => {
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page);
  await page.getByRole("button", { name: "Set up profile" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await page
    .getByLabel("Name", { exact: true })
    .fill("A very long identity name that fits the profile");
  await addLink(page, "GitHub", "https://github.com/satoshi");
  await addLink(page, "Nostr", "https://njump.me/satoshi");
  await addLink(page, "A link with a long label that has to wrap", "https://example.com/");
  const footer = page.locator("body > footer");
  for (const viewport of [
    { width: 375, height: 667 },
    { width: 520, height: 760 },
    { width: 940, height: 600 },
    { width: 1280, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const mainBox = await page.locator("main").boundingBox();
    const footerBox = await footer.boundingBox();
    expect(footerBox!.y).toBeGreaterThanOrEqual(mainBox!.y + mainBox!.height - 1);
    // Below md the actions are pinned to the window's bottom edge while the long form scrolls
    // under them, and keep Back and Continue in one row, so the bar covers little of the form.
    if (viewport.width < 768) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      const bar = (await page.locator("[data-sticky-actions]").boundingBox())!;
      expect(bar.height).toBeLessThan(100);
      expect(Math.abs(bar.y + bar.height - viewport.height)).toBeLessThanOrEqual(1);
      const back = (await page.getByRole("button", { name: "Back", exact: true }).boundingBox())!;
      const finish = (await page
        .getByRole("button", { name: "Continue", exact: true })
        .boundingBox())!;
      expect(back.x + back.width).toBeLessThanOrEqual(finish.x);
    }
    await page.screenshot({
      path: info.outputPath(`profile-${viewport.width}.png`),
      fullPage: true,
    });
  }
});

test("in the app's popup, a focused field scrolls clear of the actions pinned below it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 520, height: 760 });
  await mockPublicProfile(page, null);
  await seedProfileIdentity(page);
  await page.getByRole("button", { name: "Set up profile" }).click();
  await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
  await addLink(page, "GitHub", "https://github.com/satoshi");
  await addLink(page, "Nostr", "https://njump.me/satoshi");
  await addLink(page, "Blog", "https://example.com/");
  const lastLink = linkField(page, "Blog");
  const bar = page.locator("[data-sticky-actions]");

  // Park the field in the window but under the bar, where focusing it would otherwise leave it.
  await lastLink.evaluate((field) => {
    const box = field.getBoundingClientRect();
    window.scrollBy({ top: box.bottom - (window.innerHeight - 20), behavior: "instant" });
  });
  const barTop = (await bar.boundingBox())!.y;
  expect((await lastLink.boundingBox())!.y).toBeGreaterThan(barTop);
  await lastLink.focus();

  await expect(lastLink).toBeFocused();
  await expect
    .poll(async () => {
      const field = (await lastLink.locator("xpath=..").boundingBox())!;
      return field.y + field.height;
    })
    .toBeLessThanOrEqual((await bar.boundingBox())!.y);
});

const APP_REQUEST =
  "pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.client.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-source=Client%20App";

/**
 * Plays the network for an account created with an SMS invite: Homegate issues an invite for the
 * test homeserver, which accepts the signup and signs the new key in; PKARR relays take the new
 * record; the new pubky has no profile yet.
 */
async function mockSmsSignup(page: Page) {
  // Records published for new keys, served back to later lookups.
  const published = new Map<string, Buffer>();
  await page.route(
    (url) => PKARR_RELAY_HOSTS.has(url.hostname),
    async (route) => {
      const key = new URL(route.request().url()).pathname.slice(1);
      if (route.request().method() !== "GET") {
        const record = route.request().postDataBuffer();
        if (record) published.set(key, record);
        return route.fulfill({ status: 200, body: "" });
      }
      const body = published.get(key) ?? homeserverRecord(key);
      return route.fulfill(
        body ? { status: 200, body, contentType: "application/octet-stream" } : { status: 404 },
      );
    },
  );
  await page.route("**/sms_verification/send_code", (route) =>
    route.fulfill({ status: 200, body: "" }),
  );
  await page.route("**/sms_verification/validate_code", (route) =>
    route.fulfill({
      json: { valid: "true", signupCode: "SMS1-NV1T-C0DE", homeserverPubky: HOMESERVER },
    }),
  );
  await page.route("https://homeserver.example/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith("/signup_tokens/"))
      return route.fulfill({ json: { status: "valid" } });
    if (url.pathname === "/auth/grant/signup") return route.fulfill({ status: 200, body: "" });
    if (url.pathname === "/auth/grant/session" && request.method() === "POST")
      return route.fulfill({ json: sessionFor(request.postDataJSON() as { grant: string }) });
    return route.fulfill({ status: request.method() === "GET" ? 404 : 200, body: "" });
  });
}

for (const [name, viewport, entry] of [
  ["a phone", { width: 390, height: 844 }, "/"],
  [
    "the app's popup",
    { width: 520, height: 760 },
    `/authorize#d=${encodeURIComponent(APP_REQUEST)}`,
  ],
] as const) {
  test(`right after an account is created, it says so, and Skip for now stays in view in ${name}`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await mockSmsSignup(page);
    await page.goto(entry);
    // Join, where Passport opens with or without an app's request, offers new keys.
    await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toBeVisible();
    await page.getByRole("button", { name: "Manage your own keys" }).click();
    await page.getByRole("button", { name: "Phone number" }).click();
    await page.getByLabel("Phone number", { exact: true }).fill("+41791234567");
    await page.getByRole("button", { name: "Send Code" }).click();
    await page.getByLabel("Verification code", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "Verify Code" }).click();
    await page.getByRole("button", { name: "Keep key in this browser" }).click();
    await page
      .getByRole("dialog", { name: "Be aware of these tradeoffs:" })
      .getByRole("button", { name: "Create in browser anyway" })
      .click();
    await page.getByLabel("Enter strong password").fill("correct horse");
    await page.getByRole("button", { name: "Download recovery file" }).click();
    await page.getByRole("button", { name: "Skip this check (not recommended)" }).click();

    // The account exists: a toast says so, and its profile, the last step, follows at once.
    await expect(page.getByRole("heading", { name: "Create your profile." })).toBeVisible({
      timeout: 20_000,
    });
    const created = page.locator("[data-sonner-toast]").filter({ hasText: "Account created" });
    await expect(created.locator("[data-title]")).toHaveText("Account created");
    // The same short line with or without the app's request.
    await expect(created.locator("[data-description]")).toHaveText(
      "Your key is saved only in this browser.",
    );
    await expect(page.getByRole("navigation", { name: "Account setup progress" })).toContainText(
      "Step 3 of 3: Profile",
    );
    await expect(page.getByLabel("Name", { exact: true })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    // No Back here: Skip for now is the one way on without a profile, so it shares the pinned
    // bar with Continue, in one row, in the first screenful above the long form.
    await expect(page.getByRole("button", { name: "Back", exact: true })).toHaveCount(0);
    const later = (await page.getByRole("button", { name: "Skip for now" }).boundingBox())!;
    const finish = (await page
      .getByRole("button", { name: "Continue", exact: true })
      .boundingBox())!;
    for (const box of [later, finish]) {
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }
    expect(later.x + later.width).toBeLessThanOrEqual(finish.x);
    expect(later.y + later.height).toBeGreaterThan(finish.y);
    const bar = (await page.locator("[data-sticky-actions]").boundingBox())!;
    expect(bar.height).toBeLessThan(100);
  });
}

test("an existing profile's links of every scheme are kept, and only web addresses open", async ({
  page,
}) => {
  const links = [
    ...PROFILE.links,
    { title: "Pubky", url: `pubky://${PROFILE_KEY}` },
    { title: "Email", url: "mailto:satoshi@example.com" },
    { title: "Login", url: "https://satoshi:secret@example.com/" },
  ];
  await mockPublicProfile(page, { ...PROFILE, links });
  await seedProfileIdentity(page, false);
  await page.getByRole("button", { name: "Manage identity" }).click();
  const list = page.getByRole("list", { name: "Links" });
  await expect(list.getByRole("listitem")).toHaveCount(links.length);
  const opened = list.getByRole("link");
  await expect(opened).toHaveCount(2);
  for (const [index, { url }] of PROFILE.links.entries()) {
    await expect(opened.nth(index)).toHaveAttribute("href", url);
    await expect(opened.nth(index)).toHaveAttribute("target", "_blank");
    await expect(opened.nth(index)).toHaveAttribute("rel", "noopener noreferrer");
  }
  for (const { url } of links.slice(2))
    await expect(list.getByText(url, { exact: true })).toBeVisible();

  // Saving again refuses none of them: the save gets as far as the homeserver, which answers 503.
  await page.getByRole("button", { name: "Edit profile" }).click();
  await expect(linkField(page, "Pubky")).toHaveValue(links[2]!.url);
  await expect(linkField(page, "Email")).toHaveValue(links[3]!.url);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "Could not save your profile",
    { timeout: 15000 },
  );
  await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
});
