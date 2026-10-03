import type { AttemptController } from "../attempt/AttemptController.js";
import { isLiveState, type AttemptEvent, type AttemptModel } from "../attempt/attemptModel.js";
import type { BrowserEnvironment } from "../environment/browserEnvironment.js";
import { PassportError, type PassportErrorOptions } from "../errors/PassportError.js";
import type { FlowRegistry } from "../flow/FlowRegistry.js";
import type { PassportInstance } from "../instance/PassportInstance.js";
import { openPassportPopup } from "../popup/openPassportPopup.js";
import type { PopupPort, PopupRequest } from "../popup/PopupPort.js";
import type { PassportDiagnostic } from "../shared/PassportDiagnostic.js";
import { openSignInPopup } from "./openSignInPopup.js";
import type { AttemptResult } from "./AttemptResult.js";

interface PopupActionsOptions {
  controller: AttemptController;
  popup: PopupPort;
  flows: Pick<FlowRegistry, "instance" | "authorizationUrl">;
  defaultInstance: PassportInstance;
  instance(): PassportInstance;
  /** Also sets the id returned by the controller's next context snapshot. */
  nextAttemptId(): string;
  environment(): BrowserEnvironment;
  diagnostic?(diagnostic: PassportDiagnostic): void;
  errors?: Omit<PassportErrorOptions, "cause" | "detail" | "instance">;
}
interface ClickResult {
  closedOpening?: true;
  event?: AttemptEvent;
  popup?: Window;
  diagnostic?: PassportDiagnostic;
}

/** Internal synchronous click boundary; the model and effects retain resource ownership. */
export class PopupActions {
  private opening: Promise<AttemptResult> | undefined;
  constructor(private readonly options: PopupActionsOptions) {}

  signIn(): Promise<AttemptResult> {
    const { controller } = this.options;
    if (this.opening && controller.reservedResult() === this.opening) return this.opening;
    const state = controller.getState();
    if (isLiveState(state)) {
      const promise = controller.reserveResult();
      this.focus();
      return promise;
    }
    return this.click((before) => {
      const instance = this.options.instance();
      const attemptId = this.options.nextAttemptId();
      const authorizationUrl =
        before.state.status === "ready" ? this.preparedUrl(before, instance) : undefined;
      const opened = openSignInPopup(
        this.options.popup,
        { instance, attemptId, generation: 0, ...(authorizationUrl ? { authorizationUrl } : {}) },
        this.options.environment(),
      );
      return {
        ...opened,
        ...("popup" in opened.event && opened.event.popup ? { popup: opened.event.popup } : {}),
      };
    });
  }

  focus(): void {
    const { controller, popup } = this.options;
    if (this.opening && controller.reservedResult() === this.opening) return;
    const model = controller.snapshot();
    if (model.disposed || !isLiveState(model.state)) return;
    if (model.popup && !popup.isClosed(model.popup)) {
      popup.focus(model.popup);
      return;
    }
    const state = model.state;
    if (state.status === "opening" && state.ringLink) this.reopenWith(true);
    else if (state.status === "waiting" || state.status === "detached") this.reopen();
  }

  reopen(): void {
    const state = this.options.controller.snapshot().state;
    if (state.status === "waiting" || state.status === "detached") this.reopenWith(false);
  }

  /** A new window on the attempt's request; `closedOpening` replaces an opening one first. */
  private reopenWith(closedOpening: boolean): void {
    const state = this.options.controller.snapshot().state;
    if (!("attemptId" in state)) return;
    this.click((before) => {
      const authorizationUrl = this.preparedUrl(before, before.state.instance);
      if (authorizationUrl === undefined) throw new Error("Passport flow is unavailable");
      return {
        ...this.openAction("REOPEN", {
          instance: before.state.instance,
          attemptId: state.attemptId,
          generation: before.generation + 1,
          authorizationUrl,
        }),
        ...(closedOpening ? { closedOpening: true as const } : {}),
      };
    });
  }

  useDefaultInstance(): void {
    const { controller, defaultInstance } = this.options;
    const model = controller.snapshot();
    const state = model.state;
    if (
      !state.instance.isCustom ||
      (state.status !== "waiting" && state.status !== "detached" && state.status !== "failed")
    )
      return;
    this.click((before) =>
      this.openAction("USE_DEFAULT_INSTANCE", {
        instance: defaultInstance,
        attemptId: state.status === "failed" ? this.options.nextAttemptId() : state.attemptId,
        generation: state.status === "failed" ? 0 : before.generation + 1,
      }),
    );
  }

  private preparedUrl(model: AttemptModel, instance: PassportInstance): string | undefined {
    if (model.flow === undefined) return undefined;
    const flow = model.flows.get(model.flow);
    if (flow?.instance.origin !== instance.origin || flow.status !== "polling") return undefined;
    if (this.options.flows.instance(model.flow)?.origin !== instance.origin)
      throw new Error("Passport flow is unavailable");
    const url = this.options.flows.authorizationUrl(model.flow);
    if (url === undefined) throw new Error("Passport flow is unavailable");
    return url;
  }

  private openAction(type: "REOPEN" | "USE_DEFAULT_INSTANCE", request: PopupRequest): ClickResult {
    const opened = openPassportPopup(
      this.options.popup,
      request,
      this.options.environment().userActivation,
    );
    return {
      ...(opened.kind === "live"
        ? { popup: opened.popup, event: { type, popup: opened.popup } }
        : {}),
      ...(opened.diagnostic ? { diagnostic: opened.diagnostic } : {}),
    };
  }

  private click(build: (before: AttemptModel) => ClickResult): Promise<AttemptResult> {
    const { controller } = this.options;
    if (this.opening && controller.reservedResult() === this.opening) return this.opening;
    const before = controller.snapshot();
    const existing = controller.reservedResult();
    const promise = controller.reserveResult();
    if (before.disposed) return promise;
    this.opening = promise;
    let result: ClickResult | undefined;
    let handedOff = false;
    try {
      result = build(before);
      const after = controller.snapshot();
      if (after !== before || controller.reservedResult() !== promise) {
        // A Session that arrived during the click is held for its profile: it answers this click.
        if (controller.reservedResult() !== promise || !after.heldSession || before.heldSession)
          controller.failReservedResult(promise, this.error(before));
      } else if (result.event) {
        handedOff = true;
        this.handOff(result, before, promise);
      } else if (!existing) controller.failReservedResult(promise, this.error(before));
    } catch (e) {
      const error = this.error(before, e);
      if (controller.reservedResult() === promise && controller.snapshot() === before)
        controller.dispatch({
          type: "RUNTIME_FAILED",
          error,
          ...(before.flow !== undefined ? { flowId: before.flow } : {}),
          ...("attemptId" in before.state ? { attemptId: before.state.attemptId } : {}),
        });
      controller.failReservedResult(promise, error);
    } finally {
      if (!handedOff) {
        if (result) this.finishClick(result);
        if (this.opening === promise) this.opening = undefined;
      }
    }
    return promise;
  }

  private handOff(
    result: ClickResult,
    before: AttemptModel,
    promise: Promise<AttemptResult>,
  ): void {
    const { controller } = this.options;
    const complete = () => {
      this.finishClick(result);
      if (this.opening === promise) this.opening = undefined;
    };
    if (!result.closedOpening) {
      controller.dispatch(result.event!, complete, promise);
      return;
    }
    controller.dispatch(
      { type: "POPUP_CLOSED" },
      () => {
        const current = controller.snapshot();
        if (
          !current.disposed &&
          current.flow === before.flow &&
          current.popup === before.popup &&
          current.generation === before.generation &&
          "attemptId" in current.state &&
          "attemptId" in before.state &&
          current.state.attemptId === before.state.attemptId &&
          (current.state.status === "detached" ||
            (current.state.status === "waiting" && current.state.window === "closed")) &&
          controller.reservedResult() === promise
        )
          controller.dispatch(result.event!, complete, promise);
        else complete();
      },
      promise,
    );
  }

  private finishClick(result: ClickResult): void {
    // Reentrant dispatches are queued: ownership is known only after their transition.
    if (result.popup && this.options.controller.snapshot().popup !== result.popup) {
      try {
        if (!this.options.popup.isClosed(result.popup)) this.options.popup.close(result.popup);
      } catch {
        /* Browser cleanup must not replace the sign-in result. */
      }
    }
    try {
      if (result.diagnostic)
        void Promise.resolve(this.options.diagnostic?.(result.diagnostic)).catch(() => {});
    } catch {
      /* The model owns the window before any app observer can reenter. */
    }
  }

  private error(model: AttemptModel, cause?: unknown): PassportError {
    return new PassportError("internal", {
      ...this.options.errors,
      instance: model.state.instance,
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}
