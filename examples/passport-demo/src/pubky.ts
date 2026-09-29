import { AuthFlowKind, Keypair, Pubky, PublicKey } from "@synonymdev/pubky";
import type { GrantAuthFlow, Session, Signer, StoredSessionInfo } from "@synonymdev/pubky";
import { freeHandle } from "./freeHandle";
import {
  APP_CAPABILITIES,
  APP_CLIENT_ID,
  HTTP_RELAY,
  IS_TESTNET,
  STORAGE_NAMESPACE,
  TESTNET_HOST,
} from "./config";

const SESSION_KEY = STORAGE_NAMESPACE
  ? `${STORAGE_NAMESPACE}:${APP_CLIENT_ID}:session`
  : `${APP_CLIENT_ID}:session`;
const RING_AUTH_CANCELED_ERROR_NAME = "RingAuthCanceled";
const RING_AUTH_EXPIRED_ERROR_NAME = "RingAuthExpired";
const CLOSED_SIGNUP_MESSAGE =
  "This homeserver does not allow open signup. Start it with 'signup_mode = \"open\"' for creating new identities.";

export const pubky = IS_TESTNET ? Pubky.testnet(TESTNET_HOST) : new Pubky();

export interface RingAuthFlow {
  authorizationUrl: string;
  awaitApproval: Promise<Session>;
  cancel: () => void;
}

export async function signupDevelopmentUser(homeserver: string) {
  // Temporary lifetime fixes; milestone 14 replaces this auth UI.
  const keypair = Keypair.random();
  let signer: Signer | undefined;
  let homeserverKey: PublicKey | undefined;
  try {
    signer = pubky.signer(keypair);
    homeserverKey = PublicKey.from(homeserver.trim());
    try {
      await signer.signup(homeserverKey, null);
    } catch (error) {
      throw closedSignupError(error);
    }
    return await signer.signin(APP_CLIENT_ID);
  } finally {
    freeHandle(homeserverKey);
    freeHandle(signer);
    freeHandle(keypair);
  }
}

// Temporary lifetime fix; milestone 14 replaces this auth UI.
export async function startRingAuthFlow(): Promise<RingAuthFlow> {
  let flow: GrantAuthFlow | undefined;
  try {
    // The SDK takes ownership of AuthFlowKind, including when the start fails.
    flow = await pubky.startGrantAuthFlow(APP_CAPABILITIES, AuthFlowKind.signin(), {
      clientId: APP_CLIENT_ID,
      relay: HTTP_RELAY,
    });
    const authorizationUrl = flow.authorizationUrl;
    return { authorizationUrl, ...awaitRingApproval(flow) };
  } catch (error) {
    freeHandle(flow);
    throw error;
  }
}

export async function saveSession(session: Session) {
  const store = pubky.browserSessionStore;
  let stored: StoredSessionInfo | undefined;
  try {
    const previousId = localStorage.getItem(SESSION_KEY);
    stored = await store.save(session);
    try {
      localStorage.setItem(SESSION_KEY, stored.id);
    } catch (error) {
      await store.remove(stored.id).catch(() => {});
      throw error;
    }
    return { id: stored.id, previousId };
  } finally {
    freeHandle(stored);
    freeHandle(store);
  }
}

export async function restoreSavedSession() {
  const savedId = localStorage.getItem(SESSION_KEY);
  if (!savedId) return undefined;

  const store = pubky.browserSessionStore;
  try {
    return await store.restore(savedId);
  } catch (error) {
    if (isInvalidSavedSessionError(error)) {
      await forgetSavedSession(savedId);
      return undefined;
    }

    throw error;
  } finally {
    freeHandle(store);
  }
}

export async function signOut(session: Session) {
  const savedId = localStorage.getItem(SESSION_KEY);
  await session.signout();
  await forgetSavedSession(savedId);
  freeHandle(session);
}

// Temporary lifetime fix; milestone 14 replaces this auth UI.
export async function discardSession(session: Session) {
  try {
    await session.signout();
  } catch {
    // An abandoned Session is never returned to the app, even if revocation fails.
  } finally {
    freeHandle(session);
  }
}

export function isRingAuthCanceled(error: unknown) {
  return isErrorNamed(error, RING_AUTH_CANCELED_ERROR_NAME);
}

export function isRingAuthExpired(error: unknown) {
  return isErrorNamed(error, RING_AUTH_EXPIRED_ERROR_NAME);
}

// Temporary lifetime fix; milestone 14 replaces this auth UI.
function awaitRingApproval(flow: GrantAuthFlow) {
  let canceled = false;

  const awaitApproval = (async () => {
    try {
      const session = await flow.awaitApproval();
      if (canceled) {
        await discardSession(session);
        throw ringAuthCanceledError();
      }
      return session;
    } catch (error) {
      if (canceled) throw ringAuthCanceledError();
      if (isExpiredAuthError(error)) throw ringAuthExpiredError();
      throw error;
    } finally {
      freeHandle(flow);
    }
  })();

  // An abandoned start may have no consumer. Keep its eventual rejection handled.
  void awaitApproval.catch(() => {});

  return {
    awaitApproval,
    cancel: () => {
      canceled = true;
    },
  };
}

async function forgetSavedSession(savedId: string | null) {
  localStorage.removeItem(SESSION_KEY);
  await removeStoredSession(savedId);
}

export async function removeStoredSession(savedId: string | null) {
  if (!savedId) return;

  const store = pubky.browserSessionStore;
  try {
    await store.remove(savedId);
  } catch {
    // Local IndexedDB state may already be gone after a failed restore.
  } finally {
    freeHandle(store);
  }
}

function closedSignupError(error: unknown) {
  if (!isClosedSignupError(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  const wrapped = new Error(CLOSED_SIGNUP_MESSAGE);
  wrapped.cause = error;
  return wrapped;
}

function isClosedSignupError(error: unknown) {
  const statusCode = errorStatusCode(error);
  const text = errorText(error).toLowerCase();

  if (statusCode === 400) return true;
  if ((statusCode === 401 || statusCode === 403) && /signup|token|invite/.test(text)) {
    return true;
  }

  return (
    isErrorNamed(error, "AuthenticationError") ||
    text.includes("signup token required") ||
    text.includes("signup_mode") ||
    text.includes("token required")
  );
}

function isExpiredAuthError(error: unknown) {
  const text = errorText(error).toLowerCase();
  return text.includes("expired") || text.includes("timed out") || text.includes("timeout");
}

function isInvalidSavedSessionError(error: unknown) {
  return (
    isErrorNamed(error, "AuthenticationError") ||
    isErrorNamed(error, "InvalidInput") ||
    isErrorNamed(error, "ClientStateError")
  );
}

function isErrorNamed(error: unknown, name: string) {
  return error instanceof Error && error.name === name;
}

function errorStatusCode(error: unknown) {
  if (!isRecord(error) || !isRecord(error.data)) return undefined;
  const statusCode = error.data.statusCode;
  return typeof statusCode === "number" ? statusCode : undefined;
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause === undefined ? "" : ` ${errorText(error.cause)}`;
    return `${error.name} ${error.message}${cause}`;
  }

  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function ringAuthCanceledError() {
  const error = new Error("Pubky Ring sign-in canceled");
  error.name = RING_AUTH_CANCELED_ERROR_NAME;
  return error;
}

function ringAuthExpiredError() {
  const error = new Error("Pubky Ring sign-in link expired. Generate a fresh link and try again.");
  error.name = RING_AUTH_EXPIRED_ERROR_NAME;
  return error;
}
