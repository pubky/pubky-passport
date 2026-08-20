import "client-only";

/** Parser limits applied before detailed authorization processing. */
export const PUBKY_AUTH_REQUEST_LIMITS = {
  encodedDLength: 24_576,
  decodedAuthUrlLength: 8_192,
  secretLength: 1_024,
  relayUrlLength: 2_048,
  callbackUrlLength: 2_048,
  capabilityCount: 64,
  capabilityLength: 1_024,
  // Mirrors @synonymdev/pubky 0.10 storage-path validation; adapter tests guard drift.
  capabilityPathLength: 972,
} as const;
