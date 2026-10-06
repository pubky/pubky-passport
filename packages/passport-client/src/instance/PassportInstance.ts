import type { InstanceInvalidDetail } from "./instanceOrigin.js";

/** The Passport sign-ins open; `isCustom` when the person chose another than the app's own. */
export interface PassportInstance {
  readonly origin: string;
  readonly host: string;
  readonly isCustom: boolean;
}

export type InstanceChangeResult =
  | { ok: true; instance: PassportInstance }
  | {
      ok: false;
      code: "instance_invalid" | "attempt_in_progress" | "internal";
      detail?: InstanceInvalidDetail;
      message: string;
    };
