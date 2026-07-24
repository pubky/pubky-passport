import "client-only";

import type { PubkyPublicIdentity } from "../../../core/identity/pubkyIdentity";

export type LocalIdentitySummary = {
  id: string;
  publicIdentity: PubkyPublicIdentity;
};
