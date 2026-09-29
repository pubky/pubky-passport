import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorage } from "@test-utils/MemoryStorage";
import { Result } from "better-result";
import { decodeBase64Url } from "@/libs/encoding/base64Url";
import { keyLockSpikeReportSchema, SPIKE_REPORT_MAX_BYTES } from "@/libs/keyLockSpikeReport";

import { KeyLockSpike, spikeClientEngine } from "./KeyLockSpike";

const crypto = webcrypto as unknown as Crypto;
let storage: MemoryStorage;
let create: ReturnType<typeof vi.fn>;
let get: ReturnType<typeof vi.fn>;
let copy: ReturnType<typeof vi.fn>;
let outputs: Uint8Array[];

function credential() {
  const output = crypto.getRandomValues(new Uint8Array(32));
  outputs.push(output);
  const authenticatorData = new Uint8Array(37);
  authenticatorData[32] = 0x1d;
  return {
    type: "public-key",
    id: "AQIDBA",
    rawId: new Uint8Array([1, 2, 3, 4]).buffer,
    authenticatorAttachment: "platform",
    response: {
      getAuthenticatorData: () => authenticatorData.buffer,
      authenticatorData: authenticatorData.buffer,
      getTransports: () => ["internal"],
    },
    getClientExtensionResults: () => ({
      prf: { enabled: true, results: { first: output.buffer } },
    }),
    toJSON: () => {
      throw new Error("credential.toJSON must never be called");
    },
  };
}

beforeEach(() => {
  storage = new MemoryStorage();
  outputs = [];
  create = vi.fn(async () => credential());
  get = vi.fn(async () => credential());
  copy = vi.fn(async () => undefined);
  vi.stubGlobal("crypto", crypto);
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("location", { hostname: "localhost" });
  vi.stubGlobal("window", { opener: {} });
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {
    userAgent: "Mozilla/5.0 Chrome/153.0 Safari/537.36",
    maxTouchPoints: 0,
    credentials: { create, get },
    clipboard: { writeText: copy },
    locks: {},
    userActivation: { isActive: true },
  });
  vi.stubGlobal("PublicKeyCredential", {
    getClientCapabilities: async () => ({ "extension:prf": true }),
    isUserVerifyingPlatformAuthenticatorAvailable: async () => true,
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("spike ceremonies", () => {
  it("starts create on the click stack with the exact enrollment options and no attachment", async () => {
    const spike = new KeyLockSpike();
    const pending = spike.run("C");
    expect(create).toHaveBeenCalledTimes(1);
    const options = create.mock.calls[0]![0] as CredentialCreationOptions;
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.publicKey).toMatchObject({
      rp: { id: "localhost", name: "Pubky Passport" },
      authenticatorSelection: { residentKey: "discouraged", userVerification: "required" },
      attestation: "none",
      timeout: 120_000,
      pubKeyCredParams: [
        { type: "public-key", alg: -8 },
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
    });
    expect(options.publicKey?.user.name).toMatch(/^Passport key lock · Chrome · [A-Za-z0-9_-]{4}$/);
    expect(options.publicKey?.user.displayName).toBe(options.publicKey?.user.name);
    expect(options.publicKey?.user.id.byteLength).toBe(32);
    expect(options.publicKey?.challenge.byteLength).toBe(32);
    expect(options.publicKey?.extensions?.prf?.eval?.first.byteLength).toBe(32);
    expect(options.publicKey?.excludeCredentials).toEqual([]);
    expect(options.publicKey?.authenticatorSelection).not.toHaveProperty("authenticatorAttachment");
    expect(options.publicKey?.extensions?.prf?.eval).not.toHaveProperty("second");
    expect(Result.isOk(await pending)).toBe(true);
    const state = JSON.parse(storage.getItem("pubky-passport/key-lock-spike/v0")!);
    expect(decodeBase64Url(state.prfInput)).toEqual(
      options.publicKey?.extensions?.prf?.eval?.first,
    );
    expect(Object.keys(state).sort()).toEqual([
      "createdAt",
      "credentialId",
      "prfInput",
      "transports",
    ]);
    expect(spike.getSnapshot().entries.at(-1)).toMatchObject({
      up: true,
      uv: true,
      be: true,
      bs: true,
      first: expect.stringMatching(/^[a-f0-9]{8}$/),
    });
    expect(outputs.every((output) => output.every((byte) => byte === 0))).toBe(true);
  });

  it("uses the stored credential and transports synchronously and never exports its ID", async () => {
    const spike = new KeyLockSpike();
    await spike.run("C");
    const pending = spike.run("G");
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]![0]).toMatchObject({
      publicKey: {
        rpId: "localhost",
        userVerification: "required",
        timeout: 120_000,
        allowCredentials: [{ type: "public-key", transports: ["internal"] }],
      },
    });
    await pending;
    await spike.run("Copy report");
    const report = copy.mock.calls.at(-1)![0];
    expect(report).not.toContain("AQIDBA");
    expect(report).not.toContain("prfInput");
    expect(outputs.every((output) => output.every((byte) => byte === 0))).toBe(true);
  });

  it("tests exclusion without replacing the stored credential", async () => {
    const spike = new KeyLockSpike();
    await spike.run("C");
    const before = storage.getItem("pubky-passport/key-lock-spike/v0");
    create.mockRejectedValueOnce(
      new DOMException("never report this message", "InvalidStateError"),
    );
    expect(Result.isError(await spike.run("X"))).toBe(true);
    expect(create.mock.calls[1]![0].publicKey.excludeCredentials).toHaveLength(1);
    expect(storage.getItem("pubky-passport/key-lock-spike/v0")).toBe(before);
    await spike.run("Copy report");
    expect(copy.mock.calls.at(-1)![0]).toContain("InvalidStateError");
    expect(copy.mock.calls.at(-1)![0]).not.toContain("never report");
  });

  it("evaluates by credential and chains two gets", async () => {
    const spike = new KeyLockSpike();
    await spike.run("C");
    await spike.run("G2");
    expect(get.mock.calls[0]![0].publicKey.extensions.prf.evalByCredential).toHaveProperty(
      "AQIDBA",
    );
    await spike.run("H");
    expect(get).toHaveBeenCalledTimes(3);
    expect(spike.getSnapshot().entries.filter((entry) => entry.action === "H")).toHaveLength(2);
  });

  it("blocks overlap and aborts a pending operation on dispose", async () => {
    const spike = new KeyLockSpike();
    create.mockImplementationOnce(
      ({ signal }: CredentialCreationOptions) =>
        new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("", "AbortError")));
        }),
    );
    const first = spike.run("C");
    expect(Result.isError(await spike.run("C"))).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    spike.dispose();
    expect(Result.isError(await first)).toBe(true);
    expect(storage.length).toBe(0);
  });

  it("waits only for the deliberate delayed and import experiments", async () => {
    const spike = new KeyLockSpike();
    await spike.run("C");
    vi.useFakeTimers();
    const delayed = spike.run("W");
    expect(get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    await delayed;
    expect(get).toHaveBeenCalledTimes(1);
    const imported = spike.run("I");
    expect(get).toHaveBeenCalledTimes(1);
    await imported;
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("clears both PRF result buffers when a PRF output has the wrong length", async () => {
    const spike = new KeyLockSpike();
    await spike.run("C");
    const first = crypto.getRandomValues(new Uint8Array(31));
    const second = crypto.getRandomValues(new Uint8Array(32));
    const response = credential();
    get.mockResolvedValueOnce({
      ...response,
      getClientExtensionResults: () => ({ prf: { results: { first, second } } }),
    });
    expect(Result.isError(await spike.run("S"))).toBe(true);
    expect(first.every((byte) => byte === 0)).toBe(true);
    expect(second.every((byte) => byte === 0)).toBe(true);
    expect(get.mock.calls.at(-1)![0].publicKey.extensions.prf.eval.second).toHaveLength(32);
  });

  it("uses a fresh user ID and input for each create and resumes after a reload", async () => {
    const spike = new KeyLockSpike();
    await spike.run("C");
    await spike.run("C");
    expect(create.mock.calls[0]![0].publicKey.user.id).not.toEqual(
      create.mock.calls[1]![0].publicKey.user.id,
    );
    expect(create.mock.calls[0]![0].publicKey.extensions.prf.eval.first).not.toEqual(
      create.mock.calls[1]![0].publicKey.extensions.prf.eval.first,
    );
    const reloaded = new KeyLockSpike();
    expect(Result.isOk(await reloaded.run("R"))).toBe(true);
    storage.setItem("unrelated", "keep");
    await reloaded.run("Forget");
    expect(storage.getItem("pubky-passport/key-lock-spike/v0")).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");
    expect(Result.isError(await reloaded.run("G"))).toBe(true);
  });

  it("probes without a ceremony and tolerates unavailable capabilities", async () => {
    const spike = new KeyLockSpike();
    vi.stubGlobal("PublicKeyCredential", {
      getClientCapabilities: () => Promise.reject(new TypeError("private")),
    });
    expect(Result.isOk(await spike.run("P"))).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(spike.getSnapshot().entries.at(-1)).toMatchObject({
      clientEngine: "other",
      secure: true,
      opener: true,
      stored: false,
    });
    await spike.run("Copy report");
    expect(copy.mock.calls.at(-1)![0]).not.toContain("private");
  });

  it("copies and previews a diagnostic reference before import, separately from reports", async () => {
    const spike = new KeyLockSpike();
    await spike.run("C");
    await spike.run("Copy diagnostic reference");
    const reference = copy.mock.calls.at(-1)![0] as string;
    const targetStorage = new MemoryStorage();
    vi.stubGlobal("localStorage", targetStorage);
    const target = new KeyLockSpike();
    expect(target.previewReference(reference)).toEqual(Result.ok("AQIDBA"));
    expect(targetStorage.length).toBe(0);
    expect(Result.isOk(await target.run("Import diagnostic reference"))).toBe(true);
    expect(targetStorage.getItem("pubky-passport/key-lock-spike/v0")).toBe(reference);
    expect(get).not.toHaveBeenCalled();
    expect(Result.isOk(await target.run("G"))).toBe(true);
    await target.run("Copy report");
    const report = copy.mock.calls.at(-1)![0] as string;
    expect(report).not.toContain("AQIDBA");
    expect(report).not.toContain(JSON.parse(reference).prfInput);
    expect(report).not.toContain("credentialId");
  });

  it("rejects malformed, noncanonical and extra-field references without changing storage", async () => {
    const spike = new KeyLockSpike();
    await spike.run("C");
    const stored = storage.getItem("pubky-passport/key-lock-spike/v0")!;
    const reference = JSON.parse(stored);
    for (const input of [
      "{",
      "x".repeat(4097),
      ...[
        { ...reference, results: {} },
        { ...reference, secretKey: "unwanted" },
        { ...reference, prfInput: "A".repeat(42) },
        { ...reference, prfInput: "A".repeat(42) + "B" },
        { ...reference, credentialId: "AQIDBA==" },
        { ...reference, transports: ["unknown"] },
        { ...reference, createdAt: "yesterday" },
        { ...reference, credentialId: 1 },
      ].map((value) => JSON.stringify(value)),
    ]) {
      expect(Result.isOk(spike.previewReference(stored))).toBe(true);
      expect(Result.isError(spike.previewReference(input))).toBe(true);
      expect(Result.isError(await spike.run("Import diagnostic reference"))).toBe(true);
      expect(storage.getItem("pubky-passport/key-lock-spike/v0")).toBe(stored);
    }
  });

  it("keeps unexpected transports observable while storing only usable descriptors", async () => {
    const response = credential();
    create.mockResolvedValueOnce({
      ...response,
      response: {
        ...response.response,
        getTransports: () => ["internal", "cable", "internal", "future".repeat(20)],
      },
    });
    const spike = new KeyLockSpike();
    expect(Result.isOk(await spike.run("C"))).toBe(true);
    const stored = JSON.parse(storage.getItem("pubky-passport/key-lock-spike/v0")!);
    expect(stored.transports).toEqual(["internal"]);
    expect(spike.getSnapshot().entries.at(-1)).toMatchObject({
      transports: ["internal"],
      other: { transports: ["cable", "future".repeat(20).slice(0, 64)], truncated: true },
    });
    expect(Result.isOk(await spike.run("G"))).toBe(true);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]![0].publicKey.allowCredentials[0].transports).toEqual(["internal"]);
    expect(Result.isOk(await spike.run("Copy report"))).toBe(true);
    expect(keyLockSpikeReportSchema.safeParse(JSON.parse(copy.mock.calls.at(-1)![0])).success).toBe(
      true,
    );
  });

  it("passes every validated transport, including the L3 smart-card value, to get", async () => {
    const response = credential();
    const transports = ["internal", "hybrid", "usb", "nfc", "ble", "smart-card"];
    create.mockResolvedValueOnce({
      ...response,
      response: { ...response.response, getTransports: () => transports },
    });
    const spike = new KeyLockSpike();
    await spike.run("C");
    await spike.run("G");
    expect(get.mock.calls[0]![0].publicKey.allowCredentials[0].transports).toEqual(transports);
  });

  it("reports extra capability names and bounds session history by bytes", async () => {
    vi.stubGlobal("PublicKeyCredential", {
      getClientCapabilities: async () => ({
        ...Object.fromEntries(
          Array.from({ length: 33 }, (_, i) => [String(i).padEnd(64, "c"), true]),
        ),
        ["x".repeat(65)]: true,
        nonboolean: "do not serialize this value",
      }),
    });
    const spike = new KeyLockSpike();
    await spike.run("P");
    const first = spike.getSnapshot().entries[0]!;
    expect(Object.keys(first.capabilities!)).toHaveLength(32);
    expect(first.other).toEqual({
      capabilities: ["32".padEnd(64, "c"), "x".repeat(64), "nonboolean"],
      truncated: true,
    });
    for (let i = 0; i < 60; i++) expect(Result.isOk(await spike.run("P"))).toBe(true);
    expect(Result.isOk(await spike.run("Copy report"))).toBe(true);
    const text = copy.mock.calls.at(-1)![0];
    expect(new TextEncoder().encode(text).byteLength).toBeLessThanOrEqual(SPIKE_REPORT_MAX_BYTES);
    const report = JSON.parse(text);
    expect(keyLockSpikeReportSchema.safeParse(report).success).toBe(true);
    expect(report.entries.length).toBeGreaterThan(0);
    expect(report.droppedEntries + report.entries.length).toBe(61);
    expect(report.droppedEntries).toBeGreaterThan(0);
    expect(text).not.toContain("do not serialize this value");
    await spike.run("C");
    expect(Result.isOk(await spike.run("G"))).toBe(true);
  });

  it("cannot poison subsequent gets or exports with an invalid telemetry field", async () => {
    vi.stubGlobal("navigator", { ...navigator, maxTouchPoints: -1 });
    const spike = new KeyLockSpike();
    expect(Result.isOk(await spike.run("P"))).toBe(true);
    await spike.run("C");
    expect(Result.isOk(await spike.run("G"))).toBe(true);
    expect(Result.isOk(await spike.run("Copy report"))).toBe(true);
    const report = JSON.parse(copy.mock.calls.at(-1)![0]);
    expect(report.invalidEntries).toBe(1);
    expect(report.entries.map((entry: { action: string }) => entry.action)).toEqual(["C", "G"]);
    expect(keyLockSpikeReportSchema.safeParse(report).success).toBe(true);
  });

  it.each(["G", "X"] as const)(
    "records missing-reference %s without a false exclusion observation",
    async (action) => {
      const spike = new KeyLockSpike();
      expect(Result.isError(await spike.run(action))).toBe(true);
      expect(spike.getSnapshot().entries.at(-1)?.errorName).toBe("NotFoundError");
      expect(create).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    },
  );

  it.each(["G", "G2", "R", "W", "I", "H", "S"] as const)(
    "%s always evaluates the saved input for the saved credential",
    async (action) => {
      const spike = new KeyLockSpike();
      await spike.run("C");
      const reference = JSON.parse(storage.getItem("pubky-passport/key-lock-spike/v0")!);
      vi.useFakeTimers();
      const pending = spike.run(action);
      if (action === "W") await vi.advanceTimersByTimeAsync(1000);
      expect(Result.isOk(await pending)).toBe(true);
      expect(get).toHaveBeenCalledTimes(action === "H" ? 2 : 1);
      for (const [options] of get.mock.calls) {
        expect(options.publicKey.allowCredentials[0].id).toEqual(
          decodeBase64Url(reference.credentialId),
        );
        const prf = options.publicKey.extensions.prf;
        expect(
          (action === "G2" ? prf.evalByCredential[reference.credentialId] : prf.eval).first,
        ).toEqual(decodeBase64Url(reference.prfInput));
      }
    },
  );

  it("clears both result buffers after digest rejection", async () => {
    const spike = new KeyLockSpike();
    await spike.run("C");
    const first = crypto.getRandomValues(new Uint8Array(32));
    const second = crypto.getRandomValues(new Uint8Array(32));
    get.mockResolvedValueOnce({
      ...credential(),
      getClientExtensionResults: () => ({ prf: { results: { first, second } } }),
    });
    vi.spyOn(crypto.subtle, "digest").mockRejectedValueOnce(new DOMException("", "OperationError"));
    expect(Result.isError(await spike.run("S"))).toBe(true);
    expect(first).toEqual(new Uint8Array(32));
    expect(second).toEqual(new Uint8Array(32));
  });

  it.each([201, 403])("sends a bounded validated report and handles status %s", async (status) => {
    const send = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal("fetch", send);
    const spike = new KeyLockSpike();
    await spike.run("C");
    expect(Result.isOk(await spike.run("Send report"))).toBe(status === 201);
    const [url, options] = send.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("/dev/key-lock-spike/report");
    expect(options.method).toBe("POST");
    expect(keyLockSpikeReportSchema.safeParse(JSON.parse(options.body as string)).success).toBe(
      true,
    );
    expect(options.body).not.toContain("credentialId");
    expect(options.body).not.toContain("prfInput");
    expect(spike.getSnapshot().entries.at(-1)?.errorName).toBe(
      status === 403 ? "OperationError" : undefined,
    );
  });

  it("lists each observed error once", async () => {
    const spike = new KeyLockSpike();
    await spike.run("G");
    await spike.run("G");
    await spike.run("E");
    expect(spike.getSnapshot().entries.at(-1)?.errors).toEqual(["NotFoundError"]);
  });

  it("retains the nonsecret reference preview across lifecycle disposal", async () => {
    const spike = new KeyLockSpike();
    await spike.run("C");
    const reference = storage.getItem("pubky-passport/key-lock-spike/v0")!;
    expect(Result.isOk(spike.previewReference(reference))).toBe(true);
    spike.dispose();
    expect(Result.isOk(await spike.run("Import diagnostic reference"))).toBe(true);
    expect(storage.getItem("pubky-passport/key-lock-spike/v0")).toBe(reference);
  });

  it("omits activation observations when the API is missing", async () => {
    vi.stubGlobal("navigator", { ...navigator, userActivation: undefined });
    const spike = new KeyLockSpike();
    await spike.run("C");
    await spike.run("G");
    await spike.run("Copy report");
    expect(copy.mock.calls.at(-1)![0]).not.toContain("activeAt");
  });

  it.each([
    ["Chrome/153 Edg/153", "Edge"],
    ["EdgiOS/153", "Edge"],
    ["CriOS/153", "Chrome"],
    ["FxiOS/153", "Firefox"],
    ["Firefox/153", "Firefox"],
    ["AppleWebKit/605 Safari/605", "Safari"],
    ["Unknown", "Browser"],
  ])("labels %s as %s", async (userAgent, name) => {
    vi.stubGlobal("navigator", { ...navigator, userAgent });
    await new KeyLockSpike().run("C");
    expect(create.mock.calls[0]![0].publicKey.user.name).toMatch(
      new RegExp(`^Passport key lock · ${name} · [A-Za-z0-9_-]{4}$`),
    );
  });
});

it.each([
  ["Macintosh AppleWebKit/537.36 Chrome/153 Safari/537.36", 5, "webkit"],
  ["Macintosh AppleWebKit/537.36 Chrome/153 Safari/537.36", 1, "other"],
  ["X11 Linux AppleWebKit/537 Chromium/150 Safari/537", 0, "other"],
  ["Windows AppleWebKit/537 Safari/537 Edg/150", 0, "other"],
  ["Windows AppleWebKit/537 Safari/537 OPR/110", 0, "other"],
  ["iPod touch", 0, "webkit"],
  ["iPhone Safari/", 0, "webkit"],
  ["iPad Safari/", 0, "webkit"],
  ["Macintosh AppleWebKit/605 Safari/605", 5, "webkit"],
  ["CriOS/153", 0, "webkit"],
  ["FxiOS/155", 0, "webkit"],
  ["EdgiOS/153", 0, "webkit"],
  ["OPiOS/153", 0, "webkit"],
  ["Macintosh AppleWebKit/605 Safari/605", 0, "webkit"],
  ["Epiphany AppleWebKit/605", 0, "webkit"],
  ["Macintosh AppleWebKit/537 Chrome/153 Safari/537", 0, "other"],
  ["Windows AppleWebKit/537 Chrome/153 Edg/153", 0, "other"],
  ["Linux Firefox/155", 0, "other"],
  ["Android AppleWebKit/537 Chrome/153", 5, "other"],
] as const)("classifies %s (%s touch points) as %s", (ua, touches, expected) => {
  expect(spikeClientEngine(ua, touches)).toBe(expected);
});
