import { z } from "zod";

import type { PubkyNetworkConfig } from "./pubkyNetwork";

const publicLink = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password;
}, "Provider links must use HTTPS without credentials.");

/** Operator settings from `PASSPORT_PROVIDER_CONFIG_JSON`; never include credentials in them. */
export const passportProviderSchema = z
  .object({
    // Omitted means Google follows `GOOGLE_CLIENT_ID`; the server resolves the effective flag.
    googleEnabled: z.boolean().optional(),
    verificationMethods: z
      .array(z.enum(["lightning", "sms", "invite"]))
      .min(1)
      .max(3)
      .refine((methods) => new Set(methods).size === methods.length)
      .default(["lightning", "sms", "invite"]),
    storageDescription: z.string().trim().min(1).max(200).optional(),
    paymentDescription: z.string().trim().min(1).max(100).optional(),
    termsUrl: publicLink.optional(),
    privacyUrl: publicLink.optional(),
    upgradeUrl: publicLink.optional(),
  })
  .strict();

export type PassportProviderSettings = z.infer<typeof passportProviderSchema>;

/** Public instance configuration, resolved once on the server and rendered into the root layout. */
export type PassportProvider = Omit<PassportProviderSettings, "googleEnabled"> & {
  /** Effective feature flags; UI branches on these, never on credentials. */
  features: { google: boolean };
  /**
   * The provider's homeserver from `PUBKY_SIGNUP_HOMESERVER`, or `null` when the instance names
   * none: manual invite prefill, storage-offer gate and fallback republish target.
   */
  homeserver: string | null;
  /**
   * The HTTP relay of Passport's own grant requests (Ring profile editing), from
   * `PUBKY_HTTP_RELAY_URL`, or `PUBKY_TESTNET_HTTP_RELAY` on a testnet. Requests bring their own.
   */
  httpRelay: string;
  /** `PUBKY_NETWORK` with what the browser needs to reach it; mainnet uses the SDK defaults. */
  network: PubkyNetworkConfig;
};
