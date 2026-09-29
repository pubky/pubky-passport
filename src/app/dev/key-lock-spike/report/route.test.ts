import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST, GET, HEAD, OPTIONS, PUT, PATCH, DELETE } from "./route";

const REPORT = { version: 0, userAgent: "spike test browser", entries: [] };
let directory: string;

function request(body = JSON.stringify(REPORT), site: string | null = "same-origin") {
  return new Request("http://localhost/dev/key-lock-spike/report", {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", ...(site ? { "Sec-Fetch-Site": site } : {}) },
  });
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "passport-spike-test-"));
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("SPIKE_REPORT_DIR", directory);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  await rm(directory, { recursive: true, force: true });
});

describe("dev-only report sink", () => {
  it("is 404 in production even when a directory is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await POST(request())).status).toBe(404);
    for (const handler of [GET, HEAD, OPTIONS, PUT, PATCH, DELETE])
      expect(handler().status).toBe(404);
    expect(await readdir(directory)).toEqual([]);
  });

  it("allows only POST in development", () => {
    for (const handler of [GET, HEAD, OPTIONS, PUT, PATCH, DELETE])
      expect(handler().status).toBe(405);
  });

  it("is 404 when no report directory is configured", async () => {
    vi.stubEnv("SPIKE_REPORT_DIR", "");
    expect((await POST(request())).status).toBe(404);
  });

  it.each([null, "same-site", "cross-site", "none"])("rejects fetch site %s", async (site) => {
    expect((await POST(request(undefined, site))).status).toBe(403);
    expect(await readdir(directory)).toEqual([]);
  });

  it("bounds streamed bodies even without Content-Length", async () => {
    expect((await POST(request(" ".repeat(16 * 1024 + 1)))).status).toBe(413);
    expect(await readdir(directory)).toEqual([]);
  });

  it("rejects malformed and secret-bearing input without reflecting it", async () => {
    for (const body of ["bad JSON", JSON.stringify({ ...REPORT, prfInput: "DO-NOT-ECHO" })]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
      expect(await response.text()).not.toContain(body);
    }
    expect(await readdir(directory)).toEqual([]);
  });

  it("writes the validated report with a UTC/hash name and never overwrites it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-29T12:34:56Z"));
    expect((await POST(request())).status).toBe(201);
    const digest = createHash("sha256").update(REPORT.userAgent).digest("hex").slice(0, 8);
    const filename = `20260929T123456Z-${digest}.json`;
    expect(await readdir(directory)).toEqual([filename]);
    expect(JSON.parse(await readFile(join(directory, filename), "utf8"))).toEqual(REPORT);
    expect((await POST(request())).status).toBe(409);
    expect(JSON.parse(await readFile(join(directory, filename), "utf8"))).toEqual(REPORT);
  });
});
