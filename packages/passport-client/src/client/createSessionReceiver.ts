import type { Session } from "@synonymdev/pubky";
import type { AttemptController } from "../attempt/AttemptController.js";
import type { FlowPort } from "../flow/FlowPort.js";
import { capabilitiesMatch } from "../flow/capabilitiesMatch.js";
import type { PassportInstance } from "../instance/PassportInstance.js";

interface SessionReceiverOptions {
  capabilities: string;
  normalize(input: string): string;
  adapter(instance: PassportInstance): Pick<FlowPort, "sessionInfo">;
}

/** SDK getters run only after the controller claims this handle, using its original flow pin. */
export function createSessionReceiver(
  controller: AttemptController,
  options: SessionReceiverOptions,
): (flowId: number, session: Session) => void {
  return (flowId, session) => {
    controller.receiveSession(flowId, session, (instance) => {
      const result = options.adapter(instance).sessionInfo(session);
      if (!result.ok)
        return {
          error: result.error,
          ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
        };
      return {
        ...result.value,
        capabilitiesMatch: capabilitiesMatch(
          options.capabilities,
          result.value.capabilities,
          options.normalize,
        ),
      };
    });
  };
}
