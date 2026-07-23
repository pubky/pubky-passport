import { expect, test } from "@playwright/test";

const authRequest =
  "pubkyauth://signin?caps=/:rw&relay=https://relay.e2e.invalid/inbox&secret=e2e-sensitive";

test("production home and health endpoint are available", async ({ page, request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toEqual({ ok: true });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Pubky Passport development", level: 1 })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Selected identity" })).toHaveValue("");
  await expect(page.getByRole("button", { name: "Add identity" })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "Pubky authorization request" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete identity from Google" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear local identities" })).toHaveCount(0);
});

test("invalid manual requests are cleared without redisplaying secrets", async ({ page }) => {
  await page.goto("/");
  const input = page.getByRole("textbox", { name: "Pubky authorization request" });

  await input.fill("pubkyauth://signin?secret=e2e-sensitive-invalid");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText(/Enter a valid Pubky authorization request/)).toContainText(
    "Paste the complete request again",
  );
  await expect(input).toHaveValue("");
  await expect(page.locator("body")).not.toContainText("e2e-sensitive-invalid");
});

test("manual authorization reaches review and cancels locally", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "Pubky authorization request" }).fill(authRequest);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page).toHaveURL("http://127.0.0.1:3100/authorize");
  await expect(page.getByRole("heading", { name: "An app", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Requested permissions", level: 2 })).toBeVisible();
  await expect(page.getByText("Read and Write")).toBeVisible();
  await expect(page.getByText("Broad access")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("e2e-sensitive");

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("heading", { name: "Authorization cancelled", level: 1 })).toBeVisible();
  await expect(page.getByText("No authorization was granted.")).toBeVisible();
});

test("approval without an identity fails safely after query scrubbing", async ({ page }) => {
  const response = await page.goto(`/authorize?d=${encodeURIComponent(authRequest)}`);

  expect(response?.headers()["cache-control"]).toContain("no-store");
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(page).toHaveURL("http://127.0.0.1:3100/authorize");
  await expect(page.locator("body")).not.toContainText("e2e-sensitive");

  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { name: "Authorization failed", level: 1 })).toBeVisible();
  await expect(page.getByText(/could not find an active identity/)).toBeVisible();
});
