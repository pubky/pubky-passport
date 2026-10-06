import type { CallbackWarning } from "@/client/logic/authorization/opener/describeCallbackWarning";

export function CallbackOriginWarning({ warning }: { warning: CallbackWarning | undefined }) {
  return warning ? (
    <p className="break-words text-sm font-medium leading-5 text-foreground">
      This app asks to return you to <bdi>{warning.callbackHost}</bdi>, which is not{" "}
      <bdi>{warning.openerHost}</bdi>.
    </p>
  ) : null;
}
