import type { IdentityProviderId } from "../domain/provider/identityProvider";

export interface WrappingKeyDeriver {
  deriveWrappingKey(input: {
    provider: IdentityProviderId;
    issuer: string;
    subject: string;
  }): Promise<{ wrappingKey: string }>;
}
