import "client-only";

import { Pubky, PublicKey } from "@synonymdev/pubky";
import { Result, type Result as ResultType } from "better-result";

export type PubkyHomeserverResolutionResult = ResultType<string | null, { code: "invalid_pubky" | "resolution_failed" }>;

async function resolvePubkyHomeserver(publicKeyZ32: string): Promise<PubkyHomeserverResolutionResult> {
  let pubky: Pubky | undefined;
  let identity: PublicKey | undefined;
  let homeserver: PublicKey | undefined;

  try {
    identity = PublicKey.from(publicKeyZ32);
  } catch {
    return Result.err({ code: "invalid_pubky" });
  }

  try {
    pubky = new Pubky();
    homeserver = await pubky.getHomeserverOf(identity);
    return Result.ok(homeserver?.z32() ?? null);
  } catch {
    return Result.err({ code: "resolution_failed" });
  } finally {
    homeserver?.free();
    identity.free();
    pubky?.free();
  }
}

export { resolvePubkyHomeserver };
