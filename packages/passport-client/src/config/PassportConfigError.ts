import type { PassportClientOptions } from "./PassportClientOptions.js";

export interface ConfigIssue {
  option: keyof PassportClientOptions;
  code: string;
  message: string;
}

export class PassportConfigError extends Error {
  override readonly name = "PassportConfigError";
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(
      "Invalid Passport client configuration: " +
        (issues.length
          ? issues.map((issue) => `${issue.option}: ${issue.message}`).join(" ")
          : "use an options object."),
    );
    this.issues = Object.freeze(issues.map((issue) => Object.freeze({ ...issue })));
  }
}

export function invalidOption(option: ConfigIssue["option"], message: string): never {
  throw new PassportConfigError([{ option, code: "invalid_value", message }]);
}
