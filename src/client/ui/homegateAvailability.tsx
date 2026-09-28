"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { VerificationAvailability } from "@/client/logic/homegate/HomegateAvailabilityClient";
import { useGoogleIdentityConfiguration } from "./googleIdentityConfiguration";
import { usePassportCollaborators } from "./passportCollaborators";
import { usePassportProvider } from "./passportProviderConfiguration";

type AvailabilityState = {
  methods: VerificationAvailability;
  retry: () => void;
  /** Starts discovery on first use; sign-in-only visits never contact Homegate. */
  request?: () => void;
};

export const HomegateAvailabilityContext = createContext<AvailabilityState | null>(null);

type EnabledMethods = Record<keyof VerificationAvailability, boolean>;

function initialAvailability(enabled: EnabledMethods): VerificationAvailability {
  return {
    sms: { status: enabled.sms ? "checking" : "unavailable" },
    lightning: { status: enabled.lightning ? "checking" : "unavailable" },
    google: { status: enabled.google ? "checking" : "unavailable" },
  };
}

export function HomegateAvailabilityProvider({ children }: { children: ReactNode }) {
  const { googleClientId, homegateBaseUrl } = useGoogleIdentityConfiguration();
  const provider = usePassportProvider();
  const enabled = {
    google: Boolean(homegateBaseUrl && provider.features.google),
    sms: Boolean(homegateBaseUrl && provider.verificationMethods.includes("sms")),
    lightning: Boolean(homegateBaseUrl && provider.verificationMethods.includes("lightning")),
  };
  // A configuration change gets fresh state immediately, never stale capabilities from another host.
  return (
    <AvailabilityDiscovery
      key={`${homegateBaseUrl}:${googleClientId}:${JSON.stringify(enabled)}`}
      homegateBaseUrl={homegateBaseUrl}
      enabled={enabled}
    >
      {children}
    </AvailabilityDiscovery>
  );
}

function AvailabilityDiscovery({
  children,
  homegateBaseUrl,
  enabled: configuredMethods,
}: {
  children: ReactNode;
  homegateBaseUrl: string;
  enabled: EnabledMethods;
}) {
  const { createHomegateAvailabilityClient } = usePassportCollaborators();
  // The keyed parent remounts discovery whenever any deployment setting changes.
  const [enabled] = useState(configuredMethods);
  const [methods, setMethods] = useState(() => initialAvailability(enabled));
  // 0 means no screen has asked yet; probes run only for signup and identity addition.
  const [attempt, setAttempt] = useState(0);
  const request = useCallback(() => setAttempt((value) => (value === 0 ? 1 : value)), []);
  const retry = useCallback(() => {
    setMethods(initialAvailability(enabled));
    setAttempt((value) => value + 1);
  }, [enabled]);

  useEffect(() => {
    if (attempt === 0) return;
    const controller = new AbortController();
    const client = createHomegateAvailabilityClient(homegateBaseUrl);
    for (const method of ["sms", "lightning", "google"] as const) {
      if (!enabled[method]) continue;
      void client.check(method, controller.signal).then((availability) => {
        if (!controller.signal.aborted)
          setMethods((current) => ({ ...current, [method]: availability }));
      });
    }
    return () => controller.abort();
  }, [attempt, createHomegateAvailabilityClient, enabled, homegateBaseUrl]);

  return (
    <HomegateAvailabilityContext value={{ methods, retry, request }}>
      {children}
    </HomegateAvailabilityContext>
  );
}

export function useHomegateAvailability(): AvailabilityState {
  const value = useContext(HomegateAvailabilityContext);
  if (!value) throw new Error("Homegate availability provider is missing.");
  const request = value.request;
  useEffect(() => request?.(), [request]);
  return value;
}
