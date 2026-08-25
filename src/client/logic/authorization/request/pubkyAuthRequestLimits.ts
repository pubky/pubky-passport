import "client-only";

/** Parser limits applied before detailed authorization processing. */
export const PUBKY_AUTH_REQUEST_LIMITS = {
  maximumEncodedDCodeUnits: 24_576,
  maximumDecodedAuthUrlCodeUnits: 8_192,
  maximumSecretCodeUnits: 1_024,
  maximumRelayUrlCodeUnits: 2_048,
  maximumCallbackUrlCodeUnits: 2_048,
  maximumCapabilityCount: 64,
  maximumCapabilityCodeUnits: 1_024,
  // Mirrors @synonymdev/pubky 0.10 storage-path validation; adapter tests guard drift.
  maximumCapabilityPathUtf8Bytes: 972,
  maximumClientIdUtf8Bytes: 253,
} as const;
