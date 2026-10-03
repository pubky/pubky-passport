import { MAX_REDIRECT_STATE_TTL_MS } from "../config/redirectStateLimits.js";
import { validateInstanceOrigin } from "../instance/instanceOrigin.js";
import type { PassportInstance } from "../instance/PassportInstance.js";
import { systemClock, type Clock } from "../shared/Clock.js";
import type { PassportDiagnostic } from "../shared/PassportDiagnostic.js";
import { parseRedirectRecord, type RedirectRecord } from "./parseRedirectRecord.js";

const KEY = "pubky-passport:redirect:v1";
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type RedirectSlot =
  | { kind: "none" | "malformed" | "foreign" }
  | { kind: "owned"; record: RedirectRecord; instance: PassportInstance; eligible: boolean };
interface StoreOptions {
  storage(): StoragePort;
  client: string;
  /** The app's own Passport: the one origin that may be a loopback address (development). */
  defaultOrigin: string;
  clock?: Pick<Clock, "now">;
}

/** Internal sessionStorage boundary; callers consume an owned record before any SDK resume. */
export class RedirectStateStore {
  private swept = false;
  private readonly clock: Pick<Clock, "now">;
  constructor(private readonly options: StoreOptions) {
    this.clock = options.clock ?? systemClock;
  }

  save(input: { attemptId: string; state: string; instance: PassportInstance }): boolean {
    try {
      const raw = JSON.stringify({
        v: 1,
        attemptId: input.attemptId,
        client: this.options.client,
        state: input.state,
        instance: input.instance.origin,
        createdAt: this.clock.now(),
      });
      if (!parseRedirectRecord(raw)) return false;
      const storage = this.options.storage();
      storage.setItem(KEY, raw);
      return storage.getItem(KEY) === raw;
    } catch {
      // SDK state and native storage errors must never enter public errors or diagnostics.
      return false;
    }
  }

  read(): RedirectSlot {
    const raw = this.raw();
    if (raw === null) return { kind: "none" };
    const record = parseRedirectRecord(raw);
    // Another client's record is left alone, whatever its Passport.
    if (record && record.client !== this.options.client) return { kind: "foreign" };
    const instance = record && this.instance(record.instance);
    if (!record || !instance) {
      this.remove();
      return { kind: "malformed" };
    }
    let eligible = false;
    try {
      eligible = isEligible(record, this.clock.now());
    } catch {
      /* An unreadable clock cannot establish eligibility for resume. */
    }
    return { kind: "owned", record, instance, eligible };
  }

  /** Consume the owned record returned by read(), synchronously without yielding. */
  consume(record: RedirectRecord): boolean {
    if (record.client !== this.options.client) return false;
    try {
      const storage = this.options.storage();
      storage.removeItem(KEY);
      return storage.getItem(KEY) === null;
    } catch {
      return false;
    }
  }

  /** A captured attempt also protects newer owned records from stale native cleanup. */
  deleteOwned(attemptId?: string): void {
    const raw = this.raw();
    if (raw === null) return;
    const record = parseRedirectRecord(raw);
    if (
      record?.client === this.options.client &&
      (attemptId === undefined || record.attemptId === attemptId)
    )
      this.remove();
  }

  /** Return notification data after cleanup; the runtime coordinates it with handleReturn. */
  sweep(hasReturnMarker: boolean): PassportDiagnostic | undefined {
    if (this.swept) return undefined;
    this.swept = true;
    if (hasReturnMarker) return undefined;
    const raw = this.raw();
    if (raw === null) return undefined;
    const record = parseRedirectRecord(raw);
    if (!record) {
      this.remove();
      return undefined;
    }
    try {
      const now = this.clock.now();
      if (!Number.isFinite(now) || isEligible(record, now)) return undefined;
    } catch {
      return undefined;
    }
    this.remove();
    const owned = record.client === this.options.client;
    return {
      code: "redirect_state_discarded",
      ...(owned ? { attemptId: record.attemptId } : {}),
    };
  }

  /** Still a valid Passport origin; loopback only for the app's own (development). */
  private instance(origin: string): PassportInstance | undefined {
    const checked = validateInstanceOrigin(origin, {
      allowLoopback: origin === this.options.defaultOrigin,
    });
    if (!checked.ok || checked.origin !== origin) return undefined;
    return Object.freeze({
      origin,
      host: new URL(origin).host,
      isCustom: origin !== this.options.defaultOrigin,
    });
  }

  private raw(): string | null {
    try {
      return this.options.storage().getItem(KEY);
    } catch {
      return null;
    }
  }

  private remove(): void {
    try {
      this.options.storage().removeItem(KEY);
    } catch {
      /* Malformed records and startup expiry cleanup are best-effort. */
    }
  }
}

/** Saved state is usable for at most thirty minutes. */
function isEligible(record: RedirectRecord, now: number): boolean {
  return record.createdAt <= now && now - record.createdAt <= MAX_REDIRECT_STATE_TTL_MS;
}
