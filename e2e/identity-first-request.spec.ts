import { LOCAL_IDENTITY_STORAGE_ROOT, storeLocalIdentities } from "./helpers/localIdentities";
import { expect, test, type Page } from "./helpers/passportTest";

/**
 * An app's request opens on the identities that can sign it, whatever screen the app asked for
 * (`entry=`): one goes to its review, several to their list, and only with none does the entry
 * pick the start page's screen. Nothing is approved for the person, and the start page and the
 * keychain stay one press away.
 */
const FIRST = "1aeh1m9m47shq8ixa7ikaunjb81ierse9by6f7wnkbxzj4dddwdy";
const SECOND = "5jsjx1o6fzu6aeeo697r3i5rx15zq41kikcye8wtwdqm4nb4tryo";
const RING_KEY = "8pinxxgqs41n4aididenw5apqp1urfmzdztr8jt4abrkdn435ewo";
const REQUEST =
  "pubkyauth://signin?caps=/pub/app/:rw&relay=https://relay.example/inbox&secret=kqnceEMgrNQM_xi06oQXjA3cJHX_RQmw1BY6JE1bse8&x-source=Example%20App";
const LIST = "Choose the identity to sign in with.";
const ENTRIES = [undefined, "join", "google", "sign-in"] as const;

async function seed(page: Page, count: number) {
  await page.goto("/");
  await storeLocalIdentities(
    page,
    [FIRST, SECOND].slice(0, count).map((publicKeyZ32, index) => ({
      publicKeyZ32,
      googleAccount: {
        googleSubject: `google-${index}`,
        name: `Identity ${index}`,
        email: `identity-${index}@example.com`,
        pictureUrl: null,
      },
    })),
    count ? { active: FIRST } : {},
  );
}

async function openRequest(page: Page, entry: (typeof ENTRIES)[number]) {
  await page.goto(`/authorize#d=${encodeURIComponent(REQUEST)}${entry ? `&entry=${entry}` : ""}`);
}

for (const entry of ENTRIES) {
  const named = entry ? `entry=${entry}` : "no entry";

  test(`one saved identity opens on its review with ${named}`, async ({ page }) => {
    await seed(page, 1);
    await openRequest(page, entry);

    await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeVisible();
    await expect(page.getByText("identity-0@example.com", { exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: LIST })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Continue with Google." })).toHaveCount(0);
    // The other ways in stay below: the keychain, and the start page behind Use another identity.
    await expect(
      page.getByRole("button", { name: "Continue with keychain", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Use another identity", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Manage your own keys" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Import it", exact: true })).toBeVisible();
    // Back returns to the review, still waiting for Authorize.
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeVisible();
  });

  test(`two saved identities open on their list with ${named}`, async ({ page }) => {
    await seed(page, 2);
    await openRequest(page, entry);

    const list = page.getByRole("list", { name: LIST });
    await expect(list.getByRole("button")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Authorize", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Let’s join Pubky." })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Use another identity", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Continue with keychain", exact: true }),
    ).toBeVisible();
    // Picking one opens its review; nothing is approved until Authorize is pressed.
    await list.getByRole("button", { name: /identity-1@example\.com/u }).click();
    await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeVisible();
    await expect(page.getByText("identity-1@example.com", { exact: true })).toBeVisible();
  });

  test(`nothing saved opens the start page the app asked for with ${named}`, async ({ page }) => {
    await seed(page, 0);
    await openRequest(page, entry);

    await expect(
      page.getByRole("heading", {
        name: entry === "google" ? "Continue with Google." : "Let’s join Pubky.",
      }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Authorize", exact: true })).toHaveCount(0);
    await expect(page.getByRole("list", { name: LIST })).toHaveCount(0);
  });
}

test("the only identity that can sign opens on its review while a Ring identity is active", async ({
  page,
}) => {
  await seed(page, 1);
  // A key in Pubky Ring, active from Passport's home: it cannot sign the request here.
  await page.evaluate(
    ({ root, key }) => {
      localStorage.setItem(
        `${root}/identity/${key}`,
        JSON.stringify({ v: 1, publicKeyZ32: key, keySource: "ring" }),
      );
      localStorage.setItem(`${root}/active`, key);
    },
    { root: LOCAL_IDENTITY_STORAGE_ROOT, key: RING_KEY },
  );
  await openRequest(page, "join");

  await expect(page.getByRole("button", { name: "Authorize", exact: true })).toBeVisible();
  await expect(page.getByText("identity-0@example.com", { exact: true })).toBeVisible();
  await expect(page.getByRole("list", { name: LIST })).toHaveCount(0);
  // Chosen as a press on the list would choose it.
  expect(
    await page.evaluate(
      (root) => localStorage.getItem(`${root}/active`),
      LOCAL_IDENTITY_STORAGE_ROOT,
    ),
  ).toBe(FIRST);
});
