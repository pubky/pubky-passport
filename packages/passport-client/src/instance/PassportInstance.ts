import type { InstanceInvalidDetail } from "./instanceOrigin.js";

export interface PassportInstance {
  readonly origin: string;
  readonly host: string;
  readonly source: "default" | "user";
  readonly isCustom: boolean;
}

export type InstanceChangeResult =
  | { ok: true; instance: PassportInstance }
  | {
      ok: false;
      code: "instance_invalid" | "instance_not_allowed" | "attempt_in_progress";
      detail?: InstanceInvalidDetail;
      message: string;
    };
