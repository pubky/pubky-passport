import { expect, test } from "@playwright/test";

const sensitiveSecret = "e2e-sensitive-secret";
const relayOrigin = "https://relay.client.example";

test("scrubs a valid request and renders only safe review data", async ({ page, request }) => {
  const url = authorizationUrl(authorizationRequest(`${relayOrigin}/private-inbox?region=eu`));
  const baselineResponse = await request.get("/authorize");
  await page.goto("/");
  const response = await page.goto(url);

  expect(response?.ok()).toBe(true);
  const headers = response?.headers() ?? {};
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");

  const policy = headers["content-security-policy"] ?? "";
  const baselineSources = new Set(cspSources(baselineResponse.headers()["content-security-policy"] ?? "", "connect-src"));
  const authorizationSources = cspSources(policy, "connect-src");
  expect(authorizationSources.filter((source) => !baselineSources.has(source))).toEqual([relayOrigin]);
  expect(authorizationSources).not.toContain("https://client.example");
  expect(policy).not.toContain("/private-inbox");
  expect(policy).not.toContain(sensitiveSecret);

  await expect(page).toHaveURL(/\/authorize$/u);
  await expect(page.getByRole("heading", { name: "client.example" })).toBeVisible();
  await expect(page.getByText("relay.client.example", { exact: true })).toBeVisible();
  await expect(page.getByText("/pub/example.app/", { exact: true })).toBeVisible();

  const renderedReview = await page.locator("main").innerText();
  expect(renderedReview).not.toContain(sensitiveSecret);
  expect(renderedReview).not.toContain("private-inbox");
  expect(renderedReview).not.toContain("authorization-success");
  expect(await page.evaluate(() => window.location.search)).toBe("");

  await page.goBack();
  await expect(page).toHaveURL(/\/$/u);
  await page.goForward();
  await expect(page).toHaveURL(/\/authorize$/u);
  expect(await page.evaluate(() => window.location.search)).toBe("");
});

test("rejects an unsafe relay without adding it to CSP", async ({ page }) => {
  const unsafeRelayOrigin = "http://unsafe-relay.client.example";
  const url = authorizationUrl(authorizationRequest(`${unsafeRelayOrigin}/private-inbox`));
  const response = await page.goto(url);

  expect(response?.ok()).toBe(true);
  const policy = response?.headers()["content-security-policy"] ?? "";
  expect(cspSources(policy, "connect-src")).not.toContain(unsafeRelayOrigin);

  await expect(page).toHaveURL(/\/authorize$/u);
  await expect(page.getByRole("heading", { name: "Invalid authorization request" })).toBeVisible();
  expect(await page.evaluate(() => window.location.search)).toBe("");
  expect(await page.locator("main").innerText()).not.toContain(sensitiveSecret);
});

function authorizationRequest(relay: string): string {
  const request = new URL("pubkyauth://signin");
  request.searchParams.set("caps", "/pub/example.app/:rw");
  request.searchParams.set("relay", relay);
  request.searchParams.set("secret", sensitiveSecret);
  request.searchParams.set("x-success", "https://client.example/authorization-success?session=sensitive");
  request.searchParams.set("x-error", "https://client.example/authorization-error?session=sensitive");
  request.searchParams.set("x-cancel", "https://client.example/authorization-cancel?session=sensitive");
  return request.href;
}

function authorizationUrl(request: string): string {
  return `/authorize?d=${encodeURIComponent(request)}`;
}

function cspSources(policy: string, directiveName: string): string[] {
  const directive = policy
    .split(";")
    .find((candidate) => candidate.trimStart().startsWith(`${directiveName} `));
  return directive?.trim().split(/\s+/u).slice(1) ?? [];
}
