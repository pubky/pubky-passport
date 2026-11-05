import { describe, expect, it } from "vitest";

import {
  expiryLabel,
  formatGrantDate,
  parseAuthorizedAppPermission,
  permissionSummary,
} from "./authorizedAppDisplay";

const app = {
  grantId: "grant-1",
  clientId: "demo.pubky.app",
  capabilities: ["/pub/demo.pubky.app/:rw"],
  issuedAt: 1_767_225_600,
  expiresAt: 1_769_904_000,
};

describe("authorized app display", () => {
  it.each([
    ["/pub/demo.pubky.app/:rw", "/pub/demo.pubky.app/", true, true, false],
    ["/pub/demo.pubky.app/:r", "/pub/demo.pubky.app/", true, false, false],
    ["/pub/demo.pubky.app/file:w", "/pub/demo.pubky.app/file", false, true, false],
    ["/pub/secrets/:e", "/pub/secrets/", false, false, true],
    ["/:rwe", "/", true, true, true],
  ])("parses %s", (capability, path, read, write, encrypt) => {
    expect(parseAuthorizedAppPermission(capability)).toEqual({ path, read, write, encrypt });
  });

  it("keeps an unrecognised capability as its own path", () => {
    expect(parseAuthorizedAppPermission("/pub/app/")).toEqual({
      path: "/pub/app/",
      read: false,
      write: false,
      encrypt: false,
    });
  });

  it("summarises the permission count", () => {
    expect(permissionSummary({ ...app, capabilities: [] })).toBe("No data permissions");
    expect(permissionSummary(app)).toBe("1 permission");
    expect(permissionSummary({ ...app, capabilities: ["/a/:r", "/b/:w"] })).toBe("2 permissions");
  });

  it("formats grant times given in Unix seconds", () => {
    const date = new Date(app.issuedAt * 1000);
    expect(formatGrantDate(app.issuedAt, { locale: "en-GB" })).toBe(
      new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date),
    );
    expect(formatGrantDate(app.issuedAt, { locale: "en-GB", withTime: false })).toBe(
      new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date),
    );
    expect(formatGrantDate(Number.NaN)).toBe("Unknown date");
  });

  it("labels grants without an expiry", () => {
    expect(expiryLabel({ ...app, expiresAt: 0 })).toBe("Does not expire");
    expect(expiryLabel(app, { locale: "en-GB" })).toBe(
      `Expires ${formatGrantDate(app.expiresAt, { locale: "en-GB" })}`,
    );
  });
});
