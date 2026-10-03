import {
  AuthFlowKind,
  Pubky,
  validateCapabilities,
  type Capabilities,
  type PublicKey,
  type PublicStorage,
  type Session,
  type SessionInfo,
} from "@synonymdev/pubky";
import type { PubkyFacade } from "../config/PassportClientOptions.js";
import { mapSdkError } from "../errors/mapSdkError.js";
import type { PassportErrorOptions } from "../errors/PassportError.js";
import { safeSdkFailure } from "../errors/PassportErrorCause.js";
import type { ProfileDocument } from "../profile/PassportProfile.js";
import type { FlowPort, FlowResult, FlowSessionInfo } from "./FlowPort.js";

export { validateCapabilities };
let sharedPubky: Pubky | undefined;
export function getSharedPubky(): Pubky {
  return (sharedPubky ??= new Pubky());
}

const MAX_PROFILE_BYTES = 64 * 1024;

/** Public data only; neither the held Session nor its grants are needed. */
export async function readProfileDocument(
  publicKey: string,
  pubky?: PubkyFacade,
): Promise<ProfileDocument> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    // get borrows the wrapper only until its promise settles; the body streams without it.
    const storage: PublicStorage = (pubky ?? getSharedPubky()).publicStorage;
    let response: Response;
    try {
      response = await storage.get(`pubky${publicKey}/pub/pubky.app/profile.json`);
    } catch (e) {
      return safeSdkFailure(e).statusCode === 404 ? { kind: "missing" } : { kind: "error" };
    } finally {
      try {
        storage.free();
      } catch {
        /* Freeing cannot change the read. */
      }
    }
    if (response.status === 404) return { kind: "missing" };
    if (!response.ok || !response.body) return { kind: "error" };
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_PROFILE_BYTES) return { kind: "error" };
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { kind: "found", bytes };
  } catch {
    return { kind: "error" };
  } finally {
    void reader?.cancel().catch(() => {});
  }
}

export interface FlowOptions {
  readonly appName: string;
  readonly clientId: string;
  readonly capabilities: string;
  readonly pubky?: PubkyFacade;
}

/** Static and browser-dependent configuration is validated before this runtime boundary. */
export function createPubkyFlowAdapter(
  options: FlowOptions,
  errors: Omit<PassportErrorOptions, "cause" | "detail"> = {},
): FlowPort {
  const facade = () => options.pubky ?? getSharedPubky();
  const failure = (e: unknown, stage: "start" | "poll") => ({
    ok: false as const,
    ...mapSdkError(e, stage, errors),
  });
  return {
    async start(callbacks) {
      let kind: AuthFlowKind | undefined;
      try {
        const pubky = facade();
        const start = pubky.startGrantAuthFlow.bind(pubky);
        const sdkOptions = {
          clientId: options.clientId,
          xCallback: { ...callbacks, xSource: options.appName },
        };
        const capabilities = options.capabilities as Capabilities;
        kind = AuthFlowKind.signin();
        // The matching SDK consumes kind on success AND failure. Never free it afterward.
        return { ok: true, value: await start(capabilities, kind, sdkOptions) };
      } catch (e) {
        if (kind && unconsumedKindMismatch(e)) {
          try {
            kind.free();
          } catch {
            /* Preserve the original, sanitized start failure. */
          }
        }
        return failure(e, "start");
      }
    },
    async resume(saved) {
      try {
        return { ok: true, value: await facade().resumeDelegatedGrantAuthFlow(saved) };
      } catch (e) {
        return failure(e, "start");
      }
    },
    sessionInfo(session): FlowResult<FlowSessionInfo> {
      try {
        return { ok: true, value: readSessionInfo(session) };
      } catch (e) {
        return failure(e, "start");
      }
    },
  };
}

function unconsumedKindMismatch(e: unknown): boolean {
  try {
    return (
      typeof e === "object" &&
      e !== null &&
      "name" in e &&
      e.name === "Error" &&
      "message" in e &&
      e.message === "expected instance of AuthFlowKind"
    );
  } catch {
    return false;
  }
}

function readSessionInfo(session: Session): FlowSessionInfo {
  let info: SessionInfo | undefined;
  let key: PublicKey | undefined;
  try {
    info = session.info;
    key = info.publicKey;
    return Object.freeze({
      publicKey: key.z32(),
      capabilities: Object.freeze([...info.capabilities]),
    });
  } finally {
    try {
      key?.free();
    } finally {
      info?.free();
    }
  }
}
