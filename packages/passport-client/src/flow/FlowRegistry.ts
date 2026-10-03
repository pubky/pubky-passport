import type { Session } from "@synonymdev/pubky";
import type { AttemptEvent } from "../attempt/attemptModel.js";
import { PassportError, type PassportErrorOptions } from "../errors/PassportError.js";
import { mapSdkError } from "../errors/mapSdkError.js";
import type { PassportInstance } from "../instance/PassportInstance.js";
import { systemClock, type Clock } from "../shared/Clock.js";
import { createRingLink } from "../shared/RingLink.js";
import type { FlowCallbacks, FlowHandle, FlowPort, FlowResult } from "./FlowPort.js";
import { FlowRunner } from "./FlowRunner.js";

type FlowEvent = Extract<
  AttemptEvent,
  { type: "FLOW_CREATED" | "FLOW_FAILED" | "POLL_FAILED" | "RESUMED" | "RESUME_FAILED" }
>;
type ErrorOptions = Omit<PassportErrorOptions, "cause" | "detail" | "instance">;
interface FlowObserver {
  event(event: FlowEvent): void;
  /** Must take ownership synchronously, including after disposal. */
  session(flowId: number, session: Session): void;
  diagnostic?(diagnostic: { code: "sdk_duplicate_suspected" }): void;
}
interface Entry {
  id: number;
  instance: PassportInstance;
  resumed: boolean;
  ready: boolean;
  cancelled: boolean;
  runner?: FlowRunner;
}

/** The attempt model allocates monotonically increasing IDs; old IDs never regain a URL. */
export class FlowRegistry {
  #entries = new Map<number, Entry>();
  #lastId = 0;
  #disposed = false;
  constructor(
    private readonly port: (instance: PassportInstance) => Pick<FlowPort, "start" | "resume">,
    private readonly observer: FlowObserver,
    private readonly clock: Clock = systemClock,
    private readonly errors: ErrorOptions = {},
  ) {}

  create(id: number, instance: PassportInstance, callbacks?: FlowCallbacks): void {
    const entry = this.reserve(id, instance, false);
    if (entry) void this.complete(entry, () => this.port(instance).start(callbacks));
  }

  resume(id: number, instance: PassportInstance, saved: string): void {
    const entry = this.reserve(id, instance, true);
    if (entry) void this.complete(entry, () => this.port(instance).resume(saved));
  }

  authorizationUrl(id: number): string | undefined {
    return this.#entries.get(id)?.runner?.authorizationUrl;
  }
  instance(id: number): PassportInstance | undefined {
    return this.#entries.get(id)?.instance;
  }
  start(id: number): void {
    this.#entries.get(id)?.runner?.start();
  }
  retire(id: number, ms: number): void {
    this.#entries.get(id)?.runner?.retire(ms);
  }
  save(id: number): FlowResult<string> {
    return (
      this.#entries.get(id)?.runner?.save() ?? {
        ok: false,
        error: new PassportError("internal", this.errors),
      }
    );
  }
  free(id: number): void {
    const entry = this.#entries.get(id);
    if (!entry) return;
    entry.cancelled = true;
    this.#entries.delete(id);
    entry.runner?.free();
  }
  dispose(): void {
    this.#disposed = true;
    for (const id of this.#entries.keys()) this.free(id);
  }

  private reserve(id: number, instance: PassportInstance, resumed: boolean): Entry | undefined {
    if (this.#disposed || id <= this.#lastId) return;
    this.#lastId = id;
    const entry: Entry = { id, instance, resumed, ready: false, cancelled: false };
    this.#entries.set(id, entry);
    return entry;
  }

  private async complete(
    entry: Entry,
    operation: () => Promise<FlowResult<FlowHandle>>,
  ): Promise<void> {
    const errors = { ...this.errors, instance: entry.instance };
    let result: FlowResult<FlowHandle>;
    try {
      result = await operation();
    } catch (e) {
      result = { ok: false, ...mapSdkError(e, "start", errors) };
    }
    if (entry.cancelled) {
      if (result.ok) {
        try {
          // This orphan has never been polled or exposed, so no native borrow exists.
          result.value.free();
        } catch {
          /* The unclaimed handle's cleanup is attempted once. */
        }
      }
      return;
    }
    if (!result.ok) {
      this.#entries.delete(entry.id);
      this.failed(entry, result);
      return;
    }
    const runner = new FlowRunner(
      result.value,
      {
        session: (session) => this.observer.session(entry.id, session),
        failure: (failure) => this.failed(entry, failure),
        freed: () => {
          this.#entries.delete(entry.id);
        },
      },
      this.clock,
      errors,
    );
    entry.runner = runner;
    if (runner.authorizationUrl === undefined) {
      runner.start();
      return;
    }
    entry.ready = true;
    this.emit(
      entry,
      entry.resumed
        ? { type: "RESUMED", flowId: entry.id }
        : {
            type: "FLOW_CREATED",
            flowId: entry.id,
            ringLink: createRingLink(() => this.authorizationUrl(entry.id)),
          },
    );
  }

  private failed(entry: Entry, failure: ReturnType<typeof mapSdkError>): void {
    if (entry.cancelled) return;
    if (failure.diagnostic) {
      try {
        void Promise.resolve(this.observer.diagnostic?.({ code: failure.diagnostic })).catch(
          () => {},
        );
      } catch {
        /* Diagnostics cannot interrupt state or handle ownership. */
      }
    }
    this.emit(
      entry,
      !entry.ready && entry.resumed
        ? { type: "RESUME_FAILED", flowId: entry.id }
        : {
            type: entry.ready ? "POLL_FAILED" : "FLOW_FAILED",
            flowId: entry.id,
            error: failure.error,
          },
    );
  }

  private emit(entry: Entry, event: FlowEvent): void {
    try {
      void Promise.resolve(this.observer.event(event)).catch(() => this.free(entry.id));
    } catch {
      this.free(entry.id);
    }
  }
}
