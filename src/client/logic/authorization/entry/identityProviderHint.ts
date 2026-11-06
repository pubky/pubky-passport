/**
 * The sign-in provider an app says the person already chose, passed to Passport as
 * `x-provider=google|apple` beside `d` in the `/authorize` fragment. It decides which sign-in
 * screen comes first and, with local identities, which one review shows for this request. It is
 * not part of the Pubky Auth request, so the reviewed capabilities and the signed URL stay the same.
 */
export type IdentityProviderHint = "google" | "apple";

export const IDENTITY_PROVIDER_HINT_PARAMETER = "x-provider";

/** Reads one raw fragment value. Anything but exactly `google` or `apple` is no hint. */
export function parseIdentityProviderHint(
  value: string | undefined,
): IdentityProviderHint | undefined {
  return value === "google" || value === "apple" ? value : undefined;
}
