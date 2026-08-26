import { AuthFlowKind, Pubky, PublicKey, type Session } from "@synonymdev/pubky";
import { Result, type Result as ResultType } from "better-result";
import { expect, test } from "vitest";

import { IssuedPubkyAuthRequest } from "../authorization/request/IssuedPubkyAuthRequest";
import { HomegateClient } from "../homegate/HomegateClient";
import { PubkySdkAdapter } from "./PubkySdkAdapter";

const CAPABILITIES = "/pub/passport-staging.pubky.app/:rw" as const;
const RESOLUTION_TIMEOUT_MS = 60_000;
const RESOLUTION_POLL_INTERVAL_MS = 2_000;

test("completes signup, publication, signin, and both v0.10 authorization methods", async () => {
  const config = stagingConfig();
  const homegate = new HomegateClient(config.homegateBaseUrl, globalThis.fetch);
  const invitation = expectOk(
    await homegate.requestGoogleHomeserverSignupInvitation(config.googleIdToken),
    "Homegate did not issue a staging invitation",
  );
  const passport = new PubkySdkAdapter();
  const relyingParty = new Pubky();

  const approvedSessions: Session[] = [];
  try {
    const identity = expectOk(await passport.createIdentityKey(), "Passport could not create an identity");

    const signup = expectOk(await passport.signup(
      identity.keyHandle,
      invitation.homeserverPubky,
      invitation.signupCode,
    ), "Passport could not sign up with the staging invitation");
    expect(signup.publicIdentity).toEqual(identity.publicIdentity);

    expectOk(await passport.publishHomeserver(
      identity.keyHandle,
      invitation.homeserverPubky,
    ), "Passport could not publish the homeserver record");
    await expectHomeserverResolution(
      relyingParty,
      identity.publicIdentity.publicKeyZ32,
      invitation.homeserverPubky,
    );

    const signin = expectOk(
      await passport.signin(identity.keyHandle),
      "Passport could not sign in the restored identity",
    );
    expect(signin.publicIdentity).toEqual(identity.publicIdentity);

    const cookieFlow = relyingParty.startCookieAuthFlow(
      CAPABILITIES,
      AuthFlowKind.signin(),
      config.relayUrl,
    );
    const grantFlow = await relyingParty.startGrantAuthFlow(
      CAPABILITIES,
      AuthFlowKind.signin(),
      {
        clientId: "passport-staging.pubky.app",
        ...(config.relayUrl ? { relay: config.relayUrl } : {}),
      },
    );
    for (const flow of [cookieFlow, grantFlow]) {
      try {
        const request = expectOk(
          IssuedPubkyAuthRequest.issue(encodeURIComponent(flow.authorizationUrl)),
          "Passport rejected the SDK-generated authorization request",
        );

        const authorizationUrl = request.validatedUrlForApproval();
        if (!authorizationUrl) throw new Error("Issued request was unexpectedly unavailable");
        const approval = passport.approveAuthRequest(identity.keyHandle, authorizationUrl);
        const [approvedSession] = await Promise.all([
          flow.awaitApproval(),
          expectOkAsync(approval, "Passport could not approve the authorization request"),
        ]);
        approvedSessions.push(approvedSession);
        expectSession(approvedSession, identity.publicIdentity.publicKeyZ32);
      } finally {
        flow.free();
      }
    }
  } finally {
    for (const session of approvedSessions) session.free();
    relyingParty.free();
    passport.dispose();
  }
});

async function expectHomeserverResolution(
  pubky: Pubky,
  identityPubky: string,
  expectedHomeserverPubky: string,
): Promise<void> {
  const identity = PublicKey.from(identityPubky);
  const expectedHomeserver = PublicKey.from(expectedHomeserverPubky);
  const deadline = Date.now() + RESOLUTION_TIMEOUT_MS;
  try {
    while (Date.now() < deadline) {
      const homeserver = await pubky.getHomeserverOf(identity);
      if (homeserver) {
        try {
          expect(homeserver.z32()).toBe(expectedHomeserver.z32());
          return;
        } finally {
          homeserver.free();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, RESOLUTION_POLL_INTERVAL_MS));
    }
  } finally {
    expectedHomeserver.free();
    identity.free();
  }

  throw new Error("Published homeserver did not resolve before the staging deadline");
}

function expectSession(session: Session, expectedIdentityPubky: string): void {
  const info = session.info;
  const publicKey = info.publicKey;
  try {
    expect(publicKey.z32()).toBe(expectedIdentityPubky);
    expect(info.capabilities).toContain(CAPABILITIES);
  } finally {
    publicKey.free();
    info.free();
  }
}

function stagingConfig(): {
  homegateBaseUrl: string;
  googleIdToken: string;
  relayUrl?: string;
} {
  const homegateBaseUrl = requiredEnvironmentVariable("PUBKY_STAGING_HOMEGATE_URL");
  const googleIdToken = requiredEnvironmentVariable("PUBKY_STAGING_GOOGLE_ID_TOKEN");
  const relayUrl = process.env.PUBKY_STAGING_RELAY_URL?.trim();
  return {
    homegateBaseUrl,
    googleIdToken,
    ...(relayUrl ? { relayUrl } : {}),
  };
}

function requiredEnvironmentVariable(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required staging configuration: ${name}`);
  return value;
}

async function expectOkAsync<Success, Failure>(result: Promise<ResultType<Success, Failure>>, message: string): Promise<Success> {
  return expectOk(await result, message);
}

function expectOk<Success, Failure>(result: ResultType<Success, Failure>, message: string): Success {
  if (Result.isError(result)) throw new Error(message);
  return result.value;
}
