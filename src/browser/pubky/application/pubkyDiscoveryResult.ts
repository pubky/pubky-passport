import "client-only";

import type { Result } from "better-result";

export type PubkyDiscoveryErrorCode = "invalid_homeserver_pubky" | "key_unavailable" | "publish_failed";
export type PubkyDiscoveryResult = Result<void, { code: PubkyDiscoveryErrorCode }>;
