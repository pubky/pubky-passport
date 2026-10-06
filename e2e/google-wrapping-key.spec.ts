import { expect, test } from "./helpers/passportTest";

// A72: the route takes an ID token only with the preimage of the nonce Passport sent Google.
test("the wrapping-key route asks an older page to reload and refuses a malformed preimage", async ({
  page,
}) => {
  const post = (data: unknown) => page.request.post("/api/wrapping-key/google", { data });

  // A page loaded before the preimage existed sends the token alone: it is told to reload.
  const outdated = await post({ googleIdToken: "header.payload.signature" });
  expect(outdated.status()).toBe(400);
  expect(await outdated.json()).toEqual({ error: { code: "reload_required" } });

  for (const googleNoncePreimage of ["", "short", "A".repeat(42) + "B", "A".repeat(44)]) {
    const malformed = await post({
      googleIdToken: "header.payload.signature",
      googleNoncePreimage,
    });
    expect(malformed.status()).toBe(400);
    expect(await malformed.json()).toEqual({ error: { code: "invalid_request" } });
  }
});
