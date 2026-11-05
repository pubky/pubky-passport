import type { IdentityProviderAccount } from "@/client/logic/local-identity/localIdentityModels";

/** The provider's name as shown in copy, for example "Detach from Google". */
export function providerDisplayName(provider: IdentityProviderAccount["provider"]): string {
  switch (provider) {
    case "google":
      return "Google";
  }
}
