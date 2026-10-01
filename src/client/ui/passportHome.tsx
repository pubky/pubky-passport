"use client";

import { useSyncExternalStore } from "react";

import { isGoogleRedirectReturn } from "@/client/logic/google-identity/gia/googleRedirectBootstrap";
import { AuthorizationFlow } from "./authorization/authorizationFlow";
import { IdentityDashboard } from "./identity-dashboard/identityDashboard";
import { LoadingScreen } from "./shared/loadingScreen";

const subscribe = () => () => undefined;

/** Google already returns to /; resume authorization without registering another callback URI. */
export function PassportHome() {
  const redirectReturn = useSyncExternalStore(subscribe, isGoogleRedirectReturn, () => undefined);
  if (redirectReturn === undefined) return <LoadingScreen label="Loading Passport" />;
  return redirectReturn ? <AuthorizationFlow /> : <IdentityDashboard />;
}
