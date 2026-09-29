import { describe, expect, it } from "vitest";

import {
  keyLockSpikeReportSchema,
  prepareSpikeReport,
  SPIKE_REPORT_MAX_BYTES,
} from "./keyLockSpikeReport";

describe("spike report boundary", () => {
  const report = { version: 0, userAgent: "test browser", entries: [] };

  it("accepts only nonsecret telemetry", () => {
    expect(
      keyLockSpikeReportSchema.safeParse({
        ...report,
        entries: [
          { action: "G", at: new Date().toISOString(), ms: 1, first: "0123abcd", uv: true },
        ],
      }).success,
    ).toBe(true);
  });

  it.each(["credentialId", "prfInput", "results", "secretKey", "message"])(
    "rejects %s at either level",
    (field) => {
      expect(keyLockSpikeReportSchema.safeParse({ ...report, [field]: "value" }).success).toBe(
        false,
      );
      expect(
        keyLockSpikeReportSchema.safeParse({
          ...report,
          entries: [{ action: "G", at: new Date().toISOString(), ms: 1, [field]: "value" }],
        }).success,
      ).toBe(false);
    },
  );

  it("rejects full fingerprints and arbitrary error messages", () => {
    for (const fields of [{ first: "a".repeat(64) }, { errorName: "a private error message" }]) {
      expect(
        keyLockSpikeReportSchema.safeParse({
          ...report,
          entries: [{ action: "G", at: new Date().toISOString(), ms: 1, ...fields }],
        }).success,
      ).toBe(false);
    }
  });
});

it("caps escaped user-agent and count-limited logs without losing the drop count", () => {
  const entries = Array.from({ length: 50 }, () => ({
    action: "P" as const,
    at: new Date().toISOString(),
    ms: 1,
  }));
  const report = prepareSpikeReport({
    userAgent: "\u0000".repeat(3000),
    entries,
    droppedEntries: 3,
    invalidEntries: 2,
  });
  expect(report.userAgent).toHaveLength(2048);
  expect(report.entries).toHaveLength(48);
  expect(report.droppedEntries).toBe(5);
  expect(report.invalidEntries).toBe(2);
  expect(new TextEncoder().encode(JSON.stringify(report)).byteLength).toBeLessThanOrEqual(
    SPIKE_REPORT_MAX_BYTES,
  );
  expect(keyLockSpikeReportSchema.safeParse(report).success).toBe(true);
});

it.each([
  { transports: ["a".repeat(65)] },
  { capabilities: Array(33).fill("future") },
  { transports: ["future"], credentialId: "forbidden" },
])("rejects unbounded or extra observation fields: %s", (other) => {
  expect(
    keyLockSpikeReportSchema.safeParse({
      version: 0,
      userAgent: "test",
      entries: [{ action: "P", at: new Date().toISOString(), ms: 1, other }],
    }).success,
  ).toBe(false);
});
