// @vitest-environment node
import { expect, test } from "vitest";
import { PassportConfigError } from "./PassportConfigError.js";
import { resolveNetworkOptions } from "./networkOptions.js";

const TESTNET = {
  network: "testnet",
  pkarrRelays: "https://app.example/_pubky/pkarr",
  httpRelay: "https://app.example/_pubky/relay/inbox",
};

function issue(input: Parameters<typeof resolveNetworkOptions>[0]) {
  try {
    resolveNetworkOptions(input);
  } catch (error) {
    expect(error).toBeInstanceOf(PassportConfigError);
    return (error as PassportConfigError).issues[0];
  }
  return expect.fail("accepted invalid network options");
}

test("defaults to mainnet with the SDK's own relays", () => {
  expect(resolveNetworkOptions({})).toEqual({ network: "mainnet" });
  expect(resolveNetworkOptions({ network: "mainnet" })).toEqual({ network: "mainnet" });
});

test("a testnet takes both relays, as a comma list or a list, normalized and frozen", () => {
  const resolved = resolveNetworkOptions({
    ...TESTNET,
    pkarrRelays: " https://app.example/_pubky/pkarr/ , http://localhost:15411 ",
  });
  expect(resolved).toEqual({
    network: "testnet",
    // The relay client appends the key as a path segment: no trailing slash.
    pkarrRelays: ["https://app.example/_pubky/pkarr", "http://localhost:15411"],
    httpRelay: "https://app.example/_pubky/relay/inbox",
  });
  expect(Object.isFrozen(resolved)).toBe(true);
  expect(Object.isFrozen(resolved.pkarrRelays)).toBe(true);
  expect(
    resolveNetworkOptions({
      ...TESTNET,
      pkarrRelays: ["https://a.example/pkarr", "https://a.example/pkarr/"],
    }).pkarrRelays,
  ).toEqual(["https://a.example/pkarr"]);
});

test("mainnet may name its own relays", () => {
  expect(
    resolveNetworkOptions({
      pkarrRelays: ["https://pkarr.example"],
      httpRelay: "https://relay.example/inbox/",
    }),
  ).toEqual({
    network: "mainnet",
    pkarrRelays: ["https://pkarr.example"],
    httpRelay: "https://relay.example/inbox/",
  });
});

test.each([
  [{ network: "testnet" }, "pkarrRelays"],
  [{ network: "testnet", pkarrRelays: TESTNET.pkarrRelays }, "httpRelay"],
  [{ network: "testnet", httpRelay: TESTNET.httpRelay }, "pkarrRelays"],
])("a testnet without both relays is refused: %j", (input, option) => {
  expect(issue(input)).toMatchObject({
    option,
    message: "A testnet needs both its PKARR relays and its HTTP relay.",
  });
});

test.each(["Testnet", "devnet", "", 1, null])("refuses the network %j", (network) => {
  expect(issue({ network })).toMatchObject({ option: "network" });
});

test.each([
  "http://pkarr.example",
  "http://10.0.0.1:15411",
  "https://user:pass@pkarr.example",
  "https://pkarr.example/?x=1",
  "https://pkarr.example/?",
  "https://pkarr.example/#",
  "ftp://pkarr.example",
  "not a url",
  "https://pkarr.example/a b",
  "https://pkarr.example/\u0000",
  "",
])("refuses the relay URL %j", (url) => {
  expect(issue({ ...TESTNET, pkarrRelays: url })).toMatchObject({ option: "pkarrRelays" });
  expect(issue({ ...TESTNET, httpRelay: url })).toMatchObject({ option: "httpRelay" });
});

test.each([[[]], [Array(9).fill("https://pkarr.example")], [5], [{}], ["a,,b"]])(
  "refuses the relay list %j",
  (pkarrRelays) => {
    expect(issue({ ...TESTNET, pkarrRelays })).toMatchObject({ option: "pkarrRelays" });
  },
);

test("allows HTTP only on loopback hosts", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"])
    expect(
      resolveNetworkOptions({ ...TESTNET, httpRelay: `http://${host}:15412/inbox` }).httpRelay,
    ).toBe(`http://${host}:15412/inbox`);
});
