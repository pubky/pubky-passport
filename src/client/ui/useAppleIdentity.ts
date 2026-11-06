import type { Result } from "better-result";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type {
  AppleIdentityConfiguration,
  AppleIdentityViewError,
  AppleIdentityViewState,
} from "@/client/logic/apple-identity/AppleIdentityController";
import type { PubkyPublicIdentity } from "@/client/logic/pubky/pubkyIdentityKey";
import { LOGGER, safeErrorLogFields } from "@/libs/logger/logger";
import { useAppleIdentityConfiguration } from "./appleIdentityConfiguration";
import { useGoogleIdentityConfiguration } from "./googleIdentityConfiguration";
import {
  usePassportCollaborators,
  type AppleIdentityControllerPort,
} from "./passportCollaborators";

type Snapshot = { ready: boolean; state: AppleIdentityViewState };
type Operation = (
  controller: AppleIdentityControllerPort,
) => Promise<Result<void, AppleIdentityViewError>>;

const IDLE_SNAPSHOT: Snapshot = { ready: false, state: { status: "idle" } };

/** Bridges one screen-scoped Apple identity controller to React. */
class AppleIdentityStore {
  private controller: AppleIdentityControllerPort | null = null;
  private snapshot: Snapshot = IDLE_SNAPSHOT;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly createController: (
      configuration: AppleIdentityConfiguration,
    ) => AppleIdentityControllerPort,
    private readonly configuration: AppleIdentityConfiguration,
  ) {}

  getSnapshot = (): Snapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Creates the controller. No Apple script loads until the user signs in with Apple. */
  start = (): void => {
    if (this.controller) return;
    try {
      const controller = this.createController(this.configuration);
      this.controller = controller;
      controller.subscribe(this.update);
      this.update();
    } catch (e) {
      LOGGER.warn("identity.apple.ui.failed", {
        operation: "construct_controller",
        ...safeErrorLogFields(e),
      });
    }
  };

  /** Runs one action. It must be called from the click handler: actions open popups. */
  run = (name: string, operation: Operation): void => {
    const controller = this.controller;
    if (!controller) return;
    operation(controller).catch((e: unknown) => {
      LOGGER.warn("identity.apple.ui.failed", { operation: name, ...safeErrorLogFields(e) });
    });
  };

  reset = (): void => {
    this.controller?.reset();
  };

  dispose = (): void => {
    const controller = this.controller;
    this.controller = null;
    controller?.dispose();
    this.update();
  };

  private update = (): void => {
    const controller = this.controller;
    this.snapshot = controller ? { ready: true, state: controller.getState() } : IDLE_SNAPSHOT;
    for (const listener of this.listeners) listener();
  };
}

/**
 * Connects a screen to its own Apple identity controller. Returns `null` while Apple login is
 * off. Actions open popups, so call them directly from click handlers.
 */
export function useAppleIdentity() {
  const apple = useAppleIdentityConfiguration();
  const { homegateBaseUrl } = useGoogleIdentityConfiguration();
  const { createAppleIdentityController } = usePassportCollaborators();
  const [store] = useState(() =>
    apple
      ? new AppleIdentityStore(createAppleIdentityController, {
          servicesId: apple.servicesId,
          homegateBaseUrl,
          icloud: {
            containerId: apple.cloudKitContainerId,
            apiToken: apple.cloudKitApiToken,
            environment: apple.cloudKitEnvironment,
          },
        })
      : null,
  );
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? subscribeNowhere,
    store?.getSnapshot ?? getIdleSnapshot,
    getIdleSnapshot,
  );

  useEffect(() => {
    if (!store) return;
    store.start();
    return () => store.dispose();
  }, [store]);

  return useMemo(() => {
    if (!store) return null;
    return {
      ready: snapshot.ready,
      state: snapshot.state,
      continueWithApple: () =>
        store.run("continue_with_apple", (controller) => controller.continueWithApple()),
      connectICloud: () => store.run("connect_icloud", (controller) => controller.connectICloud()),
      detachIdentity: (publicIdentity: PubkyPublicIdentity, appleSubject: string) =>
        store.run("detach", (controller) =>
          controller.detachIdentity(publicIdentity, appleSubject),
        ),
      replaceInvalidPassportFile: () =>
        store.run("replace_invalid_file", (controller) => controller.replaceInvalidPassportFile()),
      replaceUndecryptablePassportFile: () =>
        store.run("replace_undecryptable_file", (controller) =>
          controller.replaceUndecryptablePassportFile(),
        ),
      reset: store.reset,
    };
  }, [snapshot, store]);
}

function subscribeNowhere(): () => void {
  return () => undefined;
}

function getIdleSnapshot(): Snapshot {
  return IDLE_SNAPSHOT;
}

export type AppleIdentityHandle = NonNullable<ReturnType<typeof useAppleIdentity>>;
