import { TESTNET } from "./helpers/e2eServer";
import { expect, test } from "./helpers/passportTest";
import { clientAuthRequest, clientAuthorizationPath } from "./helpers/pubkyAuthRequests";

// Runs only in the `testnet` project, against an instance with PUBKY_NETWORK=testnet.
test("marks every page and names the testnet's PKARR relay in place of the public ones", async ({
  page,
}) => {
  for (const path of ["/privacy-policy", "/"]) {
    const response = await page.goto(path);
    const policy = response?.headers()["content-security-policy"] ?? "";
    expect(policy).toContain(new URL(TESTNET.pkarrRelay).origin);
    expect(policy).not.toContain("pkarr.pubky.app");
    await expect(page.getByText("Testnet", { exact: true })).toBeVisible();
  }
});

test("refuses a request made for mainnet before showing it, and opens a testnet one", async ({
  page,
}) => {
  await page.goto(`${clientAuthorizationPath(clientAuthRequest())}&network=mainnet`);
  await expect(page.getByRole("heading", { name: "Different network." })).toBeVisible();
  await expect(
    page.getByText(
      "This app signs in on the Pubky main network, and this Passport works on the testnet.",
    ),
  ).toBeVisible();
  expect(page.url()).not.toContain("#");

  await page.goto(`${clientAuthorizationPath(clientAuthRequest())}&network=testnet`);
  await expect(page).toHaveTitle("Sign-in request | Pubky Passport");
  await expect(page.getByRole("heading", { name: "Different network." })).toHaveCount(0);
});

test("sends the SDK's localhost homeserver requests where the rewrites say", async ({
  page,
  context,
}) => {
  const seen: string[] = [];
  await context.route("https://homeserver.testnet.example/**", (route) => {
    seen.push(route.request().url());
    return route.fulfill({
      body: "rewritten",
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.goto("/");
  await expect(page.getByText("Testnet", { exact: true })).toBeVisible();
  const body = await page.evaluate(async () =>
    (await fetch("http://localhost:6286/pub/pubky.app/profile.json")).text(),
  );
  expect(body).toBe("rewritten");
  expect(seen).toEqual(["https://homeserver.testnet.example/hs/pub/pubky.app/profile.json"]);
});
