import { describe, expect, it } from "vitest";

import { relayAnswerAckUrl } from "./relayInbox";

// Each request comes from `@synonymdev/pubky` 0.11.0's `startGrantAuthFlow`, and each channel is
// the URL the SDK itself then listened on for the answer.
const SDK_VECTORS = [
  {
    request:
      "pubkyauth://signin_grant?caps=%2Fpub%2Fx%2F%3Arw&relay=https%3A%2F%2Frelay.example%2Finbox%2F&secret=yCWC6YSfDmO7RF7vcV2EieFcMbjAlBOYKJYXQ5FqWPg&cid=x.example",
    channel: "https://relay.example/inbox/47PfhECUvu6GdeV09cNLcUNAikKBEo-51vxwwXd_rcQ",
  },
  {
    request:
      "pubkyauth://signin_grant?caps=%2Fpub%2Fx%2F%3Arw&relay=https%3A%2F%2Frelay.example%2F&secret=PrSMa9YTHBhmuhn5INpChCnfGyRr8urm5fxeFs-aLhA&cid=x.example",
    channel: "https://relay.example/ic5g_xu0TH8rNY9J9BZiCiPfTiQsbg_gpEXb4ZA18FI",
  },
];

describe("relayAnswerAckUrl", () => {
  it.each(SDK_VECTORS)("reads the acknowledgement of the channel the SDK listens on", (vector) => {
    expect(relayAnswerAckUrl(vector.request)).toBe(`${vector.channel}/ack`);
  });

  it("keeps the relay's query after the channel, as the SDK does", () => {
    expect(
      relayAnswerAckUrl(
        "pubkyauth://signin_grant?relay=https%3A%2F%2Frelay.example%2Fa%2Fb%3Fx%3D1&secret=rqQCdWwzcNZch-u0Fwwf8jCa1XF_rgjRHngy7WFhqoI",
      ),
    ).toBe("https://relay.example/a/b/HQxxyOuBPtnUVio-4j7YG8k_vZSXTlEUgp6RCXbvW7s/ack?x=1");
  });

  it("offers no look on the legacy link channel, whose read is the delivery", () => {
    for (const relay of ["https://relay.example/link", "https://relay.example/link/"])
      expect(
        relayAnswerAckUrl(
          `pubkyauth://signin?relay=${encodeURIComponent(relay)}&secret=yCWC6YSfDmO7RF7vcV2EieFcMbjAlBOYKJYXQ5FqWPg`,
        ),
      ).toBeUndefined();
  });

  it("offers no look without a usable relay or secret", () => {
    const secret = "yCWC6YSfDmO7RF7vcV2EieFcMbjAlBOYKJYXQ5FqWPg";
    for (const request of [
      "not a url",
      `pubkyauth://signin?secret=${secret}`,
      `pubkyauth://signin?relay=http%3A%2F%2Frelay.example%2Finbox&secret=${secret}`,
      "pubkyauth://signin?relay=https%3A%2F%2Frelay.example%2Finbox",
      "pubkyauth://signin?relay=https%3A%2F%2Frelay.example%2Finbox&secret=short",
      `pubkyauth://signin?relay=https%3A%2F%2Frelay.example%2Finbox&secret=${secret.slice(0, 42)}*`,
    ])
      expect(relayAnswerAckUrl(request)).toBeUndefined();
  });
});
