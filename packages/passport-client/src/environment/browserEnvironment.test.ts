// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { browserEnvironment } from "./browserEnvironment.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(userAgent = "Mozilla/5.0 Safari/605.1.15") {
  const data = new Map([["app-owned", "preserved"]]);
  const storage = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    }),
  };
  const source = {
    top: undefined as unknown,
    self: undefined as unknown,
    location: { protocol: "https:" },
    sessionStorage: storage,
    navigator: { userAgent, standalone: false, userActivation: { isActive: true } },
    crossOriginIsolated: false,
    matchMedia: vi.fn(() => ({ matches: false })),
  };
  source.self = source;
  source.top = source;
  return { data, storage, source, read: () => browserEnvironment(source as unknown as Window) };
}

test("reads a regular browser lazily and removes only the storage probe", () => {
  const f = fixture();
  expect(f.read()).toEqual({
    topLevel: true,
    protocol: "https:",
    storageWritable: true,
    inApp: false,
    iosStandalone: false,
    crossOriginIsolated: false,
    userActivation: true,
  });
  expect([...f.data]).toEqual([["app-owned", "preserved"]]);
  expect(f.storage.setItem).toHaveBeenCalledOnce();
  expect(f.storage.removeItem).toHaveBeenCalledOnce();
});

test.each([
  "Instagram",
  "FBAN/FBIOS",
  "FBAV/500",
  "FB_IAB",
  "musical_ly",
  "BytedanceWebview",
  "Line/15",
  "Snapchat",
  "Android; wv)",
  "iPhone AppleWebKit/605",
])("recognizes the in-app hint %s", (ua) => {
  expect(fixture(ua).read().inApp).toBe(true);
});

test.each(["iPhone Safari/605", "Android Chrome/140 Safari/537", "Windows Firefox/143"])(
  "does not mark a normal browser as embedded: %s",
  (ua) => {
    expect(fixture(ua).read().inApp).toBe(false);
  },
);

test("recognizes iOS standalone from its platform flag or display mode", () => {
  const f = fixture("iPhone Safari/605");
  f.source.navigator.standalone = true;
  expect(f.read().iosStandalone).toBe(true);
  f.source.navigator.standalone = false;
  f.source.matchMedia.mockReturnValue({ matches: true });
  expect(f.read().iosStandalone).toBe(true);
  f.source.navigator.userAgent = "Macintosh Safari/605";
  expect(f.read().iosStandalone).toBe(false);
  f.source.navigator.standalone = true;
  expect(f.read().iosStandalone).toBe(true);
});

test("keeps frame, isolation and activation signals distinct", () => {
  const f = fixture();
  f.source.top = {};
  f.source.crossOriginIsolated = true;
  f.source.navigator.userActivation.isActive = false;
  expect(f.read()).toMatchObject({
    topLevel: false,
    crossOriginIsolated: true,
    userActivation: false,
  });
});

test("treats a throwing top getter as framed and optional API failures as absent", () => {
  const f = fixture();
  Object.defineProperty(f.source, "top", {
    get() {
      throw new Error("blocked frame read");
    },
  });
  Object.defineProperty(f.source.navigator, "userActivation", {
    get() {
      throw new Error("unavailable");
    },
  });
  f.source.matchMedia.mockImplementation(() => {
    throw new Error("unavailable");
  });
  expect(f.read()).toMatchObject({ topLevel: false, iosStandalone: false });
  expect(f.read()).not.toHaveProperty("userActivation");
});

test.each(["get", "set", "pre-check read", "remove", "silent"])(
  "contains storage %s failures",
  (failure) => {
    const f = fixture();
    const fail = () => {
      throw new Error("private storage failure");
    };
    if (failure === "get") Object.defineProperty(f.source, "sessionStorage", { get: fail });
    if (failure === "set") f.storage.setItem.mockImplementation(fail);
    if (failure === "pre-check read") f.storage.getItem.mockImplementation(fail);
    if (failure === "remove") f.storage.removeItem.mockImplementation(fail);
    if (failure === "silent") f.storage.setItem.mockImplementation(() => undefined);
    expect(f.read().storageWritable).toBe(false);
    expect(f.data.get("app-owned")).toBe("preserved");
    if (failure === "remove") {
      const remaining = [...f.data.keys()].filter((key) => key !== "app-owned");
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toMatch(/^pubky-passport:probe:/u);
    } else expect(f.data.size).toBe(1);
  },
);

test("SSR import does not inspect the browser", async () => {
  vi.resetModules();
  vi.stubGlobal(
    "window",
    new Proxy(
      {},
      {
        get() {
          throw new Error("eager browser read");
        },
      },
    ),
  );
  await expect(import("./browserEnvironment.js")).resolves.toHaveProperty("browserEnvironment");
});

test("preserves an existing probe key without writing or removing it", () => {
  const f = fixture();
  f.storage.getItem.mockReturnValueOnce("an existing value");
  expect(f.read().storageWritable).toBe(false);
  expect(f.storage.setItem).not.toHaveBeenCalled();
  expect(f.storage.removeItem).not.toHaveBeenCalled();
});

test.each(["write", "readback"])(
  "removes the probe after a %s failure following a write",
  (failure) => {
    const f = fixture();
    if (failure === "write")
      f.storage.setItem.mockImplementation((key, value) => {
        f.data.set(key, value);
        throw new Error("storage wrote before failing");
      });
    else
      f.storage.getItem.mockReturnValueOnce(null).mockImplementationOnce(() => {
        throw new Error("readback refused");
      });
    expect(f.read().storageWritable).toBe(false);
    expect([...f.data]).toEqual([["app-owned", "preserved"]]);
    expect(f.storage.removeItem).toHaveBeenCalledOnce();
  },
);
