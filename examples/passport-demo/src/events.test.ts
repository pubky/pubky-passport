import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Session } from "@synonymdev/pubky";
import { startAppEventStream } from "./events";

const subscribe = vi.hoisted(() => vi.fn());
const builders = vi.hoisted(() => [] as { consumed: boolean; free: ReturnType<typeof vi.fn> }[]);
function newBuilder() {
  const builder = {
    consumed: false,
    free: vi.fn(() => {
      if (builder.consumed) throw new Error("consumed builder must not be freed");
    }),
    path: vi.fn(() => {
      builder.consumed = true;
      return newBuilder();
    }),
    live: vi.fn(() => {
      builder.consumed = true;
      return newBuilder();
    }),
    subscribe: vi.fn(() => {
      builder.consumed = true;
      return subscribe();
    }),
  };
  builders.push(builder);
  return builder;
}
vi.mock("@synonymdev/pubky", () => ({
  Pubky: class {
    static testnet() {
      return { eventStreamForUser: () => newBuilder() };
    }
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  builders.length = 0;
});

afterEach(() => {
  expect(builders).toHaveLength(3);
  for (const builder of builders) {
    expect(builder.consumed).toBe(true);
    expect(builder.free).not.toHaveBeenCalled();
  }
});

function session() {
  const publicKey = { free: vi.fn() };
  return { info: { publicKey, free: vi.fn() } };
}

it("frees subscription and event handles after copying event data", async () => {
  const active = session();
  const resource = { path: "/pub/template/file", free: vi.fn() };
  const event = { eventType: "PUT", resource, cursor: "1", contentHash: "hash", free: vi.fn() };
  subscribe.mockResolvedValue(
    new ReadableStream({
      start(controller) {
        controller.enqueue(event);
        controller.close();
      },
    }),
  );
  const onEvent = vi.fn();
  const stream = await startAppEventStream(active as unknown as Session, onEvent);
  await stream.done;
  expect(onEvent).toHaveBeenCalledWith({
    type: "PUT",
    path: "/pub/template/file",
    cursor: "1",
    contentHash: "hash",
  });
  expect(active.info.free).toHaveBeenCalledOnce();
  expect(active.info.publicKey.free).toHaveBeenCalledOnce();
  expect(event.free).toHaveBeenCalledOnce();
  expect(resource.free).toHaveBeenCalledOnce();
});

it("frees subscription handles on failure", async () => {
  const active = session();
  const error = new Error("offline");
  subscribe.mockRejectedValue(error);
  await expect(startAppEventStream(active as unknown as Session, vi.fn())).rejects.toBe(error);
  expect(active.info.free).toHaveBeenCalledOnce();
  expect(active.info.publicKey.free).toHaveBeenCalledOnce();
});

it("frees event handles even when the consumer throws", async () => {
  const active = session();
  const resource = { path: "/pub/template/file", free: vi.fn() };
  const event = { eventType: "PUT", resource, cursor: "1", contentHash: "hash", free: vi.fn() };
  const cancel = vi.fn();
  subscribe.mockResolvedValue(
    new ReadableStream({
      start(controller) {
        controller.enqueue(event);
      },
      cancel,
    }),
  );
  const error = new Error("consumer failed");
  const stream = await startAppEventStream(active as unknown as Session, () => {
    throw error;
  });
  await expect(stream.done).rejects.toBe(error);
  expect(event.free).toHaveBeenCalledOnce();
  expect(resource.free).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledOnce();
  await expect(stream.stop()).resolves.toBeUndefined();
});
