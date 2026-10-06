import { DEFAULT_PUBKY_HTTP_RELAY_URL } from "@/libs/passportPolicy";
import type { PassportProvider } from "@/libs/passportProvider";
import { MAINNET } from "@/libs/pubkyNetwork";

/** The provider homeserver {@link makeInstanceConfig} names unless a test overrides it. */
export const TEST_PROVIDER_HOMESERVER = "ufibwbmed6jeq9k4p583go95wofakh9fwpp4k734trq79pd9u1uy";

/** Public configuration of an instance with every feature on and a provider homeserver. */
export function makeInstanceConfig(overrides: Partial<PassportProvider> = {}): PassportProvider {
  return {
    verificationMethods: ["lightning", "sms", "invite"],
    features: { google: true },
    homeserver: TEST_PROVIDER_HOMESERVER,
    httpRelay: DEFAULT_PUBKY_HTTP_RELAY_URL,
    network: MAINNET,
    ...overrides,
  };
}
