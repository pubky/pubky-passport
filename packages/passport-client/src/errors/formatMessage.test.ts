import { expect, test } from "vitest";
import { formatMessage } from "./formatMessage.js";
const context = {
  appName: "$& App",
  instanceHost: "custom.example",
  defaultHost: "default.example",
};

test("an override cannot change the host used by the visibility safeguard", () => {
  const output = formatMessage(
    "notice.custom-instance",
    {
      "notice.custom-instance": (value) => {
        value.instanceHost = "wrong.example";
        return "";
      },
    },
    context,
  );
  expect(output).toContain("custom.example");
  expect(output).not.toContain("wrong.example");
});
test("replaces known placeholders literally and leaves text as text", () => {
  expect(
    formatMessage(
      "label.idle",
      { "label.idle": "<img onerror> {appName} {instanceHost} {defaultHost}" },
      context,
    ),
  ).toBe("<img onerror> $& App custom.example default.example");
});
test("passes context to functions and falls back safely when a function throws", () => {
  expect(formatMessage("label.idle", { "label.idle": (c) => c.appName }, context)).toBe("$& App");
  expect(
    formatMessage(
      "label.idle",
      {
        "label.idle": () => {
          throw new Error("private");
        },
      },
      context,
    ),
  ).toBe("Sign in with Passport");
});
test.each(["notice.custom-instance", "picker.confirm"] as const)(
  "keeps the actual instance visible for %s",
  (key) => {
    for (const template of ["", () => "", "other.example", "Anderer Server"]) {
      expect(formatMessage(key, { [key]: template }, context)).toContain("custom.example");
    }
    expect(formatMessage(key, { [key]: "Using custom.example" }, context)).toBe(
      "Using custom.example",
    );
  },
);
test("provides instance validation copy", () => {
  expect(formatMessage("instance.instance_invalid", undefined, context)).toBe(
    "Enter a valid https:// Passport address.",
  );
  expect(formatMessage("instance.instance_not_allowed", undefined, context)).toBe(
    "This app only works with Passport at default.example.",
  );
  expect(formatMessage("instance.attempt_in_progress", undefined, context)).toBe(
    "Finish or cancel the current sign-in first.",
  );
});

test.each(["notice.custom-instance", "picker.confirm"] as const)(
  "requires a complete host token for %s",
  (key) => {
    for (const wrong of [
      "custom.example.org",
      "xcustom.example",
      "sub.custom.example",
      "custom.example:444",
    ]) {
      const text = `Using ${wrong}`;
      expect(formatMessage(key, { [key]: text }, context)).toBe(`${text} custom.example`);
    }
    expect(
      formatMessage(key, { [key]: "Using passport.pubky.app" }, { instanceHost: "passport.pub" }),
    ).toBe("Using passport.pubky.app passport.pub");
    for (const text of [
      "Using custom.example.",
      "https://custom.example/",
      "Server: custom.example",
      "Using CUSTOM.EXAMPLE",
    ])
      expect(formatMessage(key, { [key]: text }, context)).toBe(text);
  },
);

test("keeps safe context defaults for explicitly undefined or empty values", () => {
  const context = { appName: undefined, instanceHost: undefined, defaultHost: undefined } as never;
  expect(formatMessage("action.use-default-instance", undefined, context)).toBe(
    "Use passport.pubky.app",
  );
  expect(formatMessage("notice.custom-instance", undefined, context)).toBe(
    "Using Passport at passport.pubky.app",
  );
  expect(formatMessage("label.idle", { "label.idle": "App: {appName}" }, context)).toBe("App: ");
  expect(formatMessage("picker.reset", undefined, { defaultHost: "" })).toBe(
    "Reset to passport.pubky.app",
  );
});

test("formats the configured default in picker reset and instance-policy copy", () => {
  const context = { defaultHost: "my.example" };
  expect(formatMessage("picker.reset", undefined, context)).toBe("Reset to my.example");
  expect(formatMessage("instance.instance_not_allowed", undefined, context)).toBe(
    "This app only works with Passport at my.example.",
  );
});
