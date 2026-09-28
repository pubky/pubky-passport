import { Result } from "better-result";
import type { ProfileResult } from "./ProfileController";
import type { LoadedProfile } from "./profile";

/** Concurrent homeserver reads; a large switcher must not start unbounded requests. */
const LOAD_WORKERS = 3;

type LoadProfile = (publicKey: string) => Promise<ProfileResult<LoadedProfile | null>>;

/**
 * Loads public profiles with bounded concurrency. A key loads once until it is refreshed or
 * forgotten; refreshing or forgetting one key discards only that key's result in flight.
 * A failed load is retried by the next request for its key.
 */
export class ProfileLoadQueue {
  /** Ticket of the latest load per key, finished or in flight. */
  private readonly latest = new Map<string, number>();
  private readonly pending: { publicKey: string; ticket: number }[] = [];
  private running = 0;
  private tickets = 0;
  private disposed = false;

  constructor(
    private readonly load: LoadProfile,
    private readonly onLoaded: (publicKey: string, profile: LoadedProfile | null) => void,
  ) {}

  /** Loads every key that has not been loaded or requested yet. */
  request(publicKeys: Iterable<string>): void {
    for (const publicKey of publicKeys) {
      if (!this.latest.has(publicKey)) this.enqueue(publicKey);
    }
    this.drain();
  }

  /** Loads a key again; a result still in flight for it is discarded. */
  refresh(publicKey: string): void {
    this.enqueue(publicKey);
    this.drain();
  }

  /** Forgets every key outside `publicKeys` and returns the keys it forgot. */
  retain(publicKeys: ReadonlySet<string>): string[] {
    const forgotten = [...this.latest.keys()].filter((publicKey) => !publicKeys.has(publicKey));
    for (const publicKey of forgotten) this.latest.delete(publicKey);
    this.removePending((publicKey) => !publicKeys.has(publicKey));
    return forgotten;
  }

  dispose(): void {
    this.disposed = true;
    this.pending.length = 0;
  }

  private enqueue(publicKey: string): void {
    const ticket = ++this.tickets;
    this.latest.set(publicKey, ticket);
    this.removePending((pendingKey) => pendingKey === publicKey);
    this.pending.push({ publicKey, ticket });
  }

  private removePending(matches: (publicKey: string) => boolean): void {
    const kept = this.pending.filter(({ publicKey }) => !matches(publicKey));
    this.pending.splice(0, this.pending.length, ...kept);
  }

  private drain(): void {
    while (!this.disposed && this.running < LOAD_WORKERS && this.pending.length) {
      const { publicKey, ticket } = this.pending.shift()!;
      this.running++;
      void this.load(publicKey)
        .catch((e: unknown) => Result.err({ code: "load_failed" as const, cause: e }))
        .then((result) => {
          this.running--;
          if (this.disposed || this.latest.get(publicKey) !== ticket) return;
          if (Result.isOk(result)) this.onLoaded(publicKey, result.value);
          else this.latest.delete(publicKey);
        })
        .finally(() => this.drain());
    }
  }
}
