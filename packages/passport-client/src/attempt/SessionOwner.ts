import type { Session } from "@synonymdev/pubky";
import type { PassportDiagnostic } from "../shared/PassportDiagnostic.js";

interface OwnedSession {
  readonly session: Session;
  revocation?: Promise<void>;
}
const REVOKE_RETRY_MS = 2000;

/** A transferred handle belongs to the app and can never be reacquired here. */
export class SessionOwner {
  private readonly owned = new Map<number, OwnedSession>();
  private readonly seen = new WeakSet<Session>();
  private nextId = 0;
  private disposed = false;

  constructor(
    private readonly delay = (ms: number): Promise<void> =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly diagnostic?: (value: PassportDiagnostic) => void,
  ) {}

  register(session: Session): number | undefined {
    if (this.seen.has(session)) return undefined;
    this.seen.add(session);
    const id = ++this.nextId;
    this.owned.set(id, { session });
    if (this.disposed) void this.revoke(id);
    return id;
  }

  take(id: number): Session | undefined {
    const entry = this.owned.get(id);
    if (!entry || entry.revocation || this.disposed) return undefined;
    this.owned.delete(id);
    return entry.session;
  }

  revoke(id: number): Promise<void> {
    const entry = this.owned.get(id);
    if (!entry) return Promise.resolve();
    // Mark ownership before invoking an SDK method that could re-enter a caller.
    entry.revocation ??= Promise.resolve().then(() => this.revokeOwned(id, entry.session));
    return entry.revocation;
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return Promise.all([...this.owned.keys()].map((id) => this.revoke(id))).then(() => {});
  }

  private async revokeOwned(id: number, session: Session): Promise<void> {
    let failed = false;
    try {
      await session.signout();
    } catch {
      try {
        await this.delay(REVOKE_RETRY_MS);
        await session.signout();
      } catch {
        failed = true;
      }
    } finally {
      this.owned.delete(id);
      try {
        session.free();
      } catch {
        /* Cleanup cannot return ownership to the app. */
      }
    }
    if (failed) {
      try {
        void Promise.resolve(this.diagnostic?.({ code: "revoke_failed" })).catch(() => {});
      } catch {
        /* Application callbacks do not own the cleanup result. */
      }
    }
  }
}
