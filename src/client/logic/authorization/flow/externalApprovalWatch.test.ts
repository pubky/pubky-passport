import { describe, expect, it, vi } from "vitest";

import { approvalSeen, lookAtAppChannel, type RelayFetch } from "./externalApprovalWatch";

const ACK_URL = "https://relay.example/inbox/channel/ack";

function relayAnswering(status: number, body = ""): RelayFetch & ReturnType<typeof vi.fn> {
  return vi.fn(async () => new Response(body, { status }));
}

describe("lookAtAppChannel", () => {
  it("tells a taken answer from a posted one and from an empty channel", async () => {
    const signal = new AbortController().signal;
    await expect(lookAtAppChannel(ACK_URL, relayAnswering(200, "true"), signal)).resolves.toBe(
      "taken",
    );
    await expect(lookAtAppChannel(ACK_URL, relayAnswering(200, "false\n"), signal)).resolves.toBe(
      "posted",
    );
    // Nothing posted yet (or expired).
    await expect(lookAtAppChannel(ACK_URL, relayAnswering(404, "Not found"), signal)).resolves.toBe(
      "empty",
    );
  });

  it("treats any other reply as no usable answer", async () => {
    const signal = new AbortController().signal;
    for (const [status, body] of [
      [200, "maybe"],
      [500, "true"],
      [503, "Too many concurrent requests"],
      [408, ""],
    ] as const)
      await expect(lookAtAppChannel(ACK_URL, relayAnswering(status, body), signal)).resolves.toBe(
        "unreachable",
      );
  });

  it("only reads: a plain GET without cookies, referrer or redirects, abortable", async () => {
    const relay = relayAnswering(404);
    const controller = new AbortController();
    await lookAtAppChannel(ACK_URL, relay, controller.signal);

    expect(relay).toHaveBeenCalledOnce();
    const [url, init] = relay.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ACK_URL);
    expect(init).toMatchObject({
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(init.body).toBeUndefined();
    controller.abort();
    expect(init.signal?.aborted).toBe(true);
  });
});

describe("approvalSeen", () => {
  it("waits for the app's acknowledgement while the app can receive Passport's message", () => {
    expect(approvalSeen("taken", true)).toBe("answered");
    // Ring posted, but the app has not taken it yet: Passport must not get ahead of the app.
    expect(approvalSeen("posted", true)).toBe("waiting");
    expect(approvalSeen("empty", true)).toBe("waiting");
    expect(approvalSeen("unreachable", true)).toBe("unreachable");
  });

  it("counts a posted answer once only navigating back can reach the app", () => {
    // Same tab: the app takes the answer only after Passport navigates back to it.
    expect(approvalSeen("posted", false)).toBe("answered");
    expect(approvalSeen("taken", false)).toBe("answered");
    expect(approvalSeen("empty", false)).toBe("waiting");
    expect(approvalSeen("unreachable", false)).toBe("unreachable");
  });
});
