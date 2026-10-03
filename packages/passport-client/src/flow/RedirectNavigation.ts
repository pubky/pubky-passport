import type { AttemptController } from "../attempt/AttemptController.js";
import { PassportError, type PassportErrorOptions } from "../errors/PassportError.js";
import { authorizeUrl } from "../shared/authorizeUrl.js";
import type { FlowRegistry } from "./FlowRegistry.js";
import type { RedirectStateStore } from "./RedirectStateStore.js";

interface NavigationOptions {
  controller: Pick<AttemptController, "snapshot" | "dispatch" | "completeRedirect" | "isCurrent">;
  flows: Pick<FlowRegistry, "instance" | "authorizationUrl" | "save">;
  store: Pick<RedirectStateStore, "save" | "deleteOwned">;
  page(): { opener: unknown; location: Pick<Location, "assign"> };
  /** Passport reads `profile=required` next to `d=`, as a pop-up reads it from the hello. */
  profile: "required" | "optional";
  errors?: Omit<PassportErrorOptions, "cause" | "detail" | "instance">;
}

/** Saves, severs and navigates in one task; the owned flow stays alive for navigation. */
export class RedirectNavigation {
  private working = false;
  private committedThrough = 0;
  constructor(private readonly options: NavigationOptions) {}

  navigate(flowId: number): void {
    const { controller, flows, store } = this.options;
    const before = controller.snapshot();
    const { state } = before;
    const record = before.flows.get(flowId);
    if (
      this.working ||
      flowId <= this.committedThrough ||
      before.disposed ||
      !controller.isCurrent(before) ||
      state.status !== "redirecting" ||
      before.flow !== flowId ||
      record?.via !== "redirect" ||
      record.status !== "created" ||
      record.attemptId !== state.attemptId ||
      record.instance.origin !== state.instance.origin
    )
      return;
    this.working = true;
    let attemptedWrite = false;
    const current = () => controller.isCurrent(before);
    try {
      if (flows.instance(flowId)?.origin !== record.instance.origin) throw new Error();
      const authorizationUrl = flows.authorizationUrl(flowId);
      if (authorizationUrl === undefined) throw new Error();
      // Only the SDK's delegated save: the key never enters this tab's storage.
      const saved = flows.save(flowId);
      if (!current()) return;
      if (!saved.ok) {
        controller.dispatch({ type: "REDIRECT_SAVE_FAILED" });
        return;
      }
      attemptedWrite = true;
      const written = store.save({
        attemptId: state.attemptId,
        state: saved.value,
        instance: record.instance,
      });
      if (!current()) return;
      if (!written) {
        controller.dispatch({ type: "REDIRECT_SAVE_FAILED" });
        return;
      }
      const page = this.options.page();
      if (!current()) return;
      page.opener = null;
      if (!current()) return;
      if (page.opener !== null) throw new Error();
      if (!current()) return;
      page.location.assign(
        authorizeUrl(record.instance.origin, authorizationUrl, this.options.profile === "required"),
      );
      this.committedThrough = flowId;
      controller.completeRedirect(before);
    } catch {
      if (current())
        controller.dispatch({
          type: "RUNTIME_FAILED",
          flowId,
          attemptId: state.attemptId,
          error: new PassportError("internal", {
            ...this.options.errors,
            instance: record.instance,
          }),
        });
    } finally {
      if (attemptedWrite && !current() && flowId > this.committedThrough)
        store.deleteOwned(state.attemptId);
      this.working = false;
    }
  }
}
