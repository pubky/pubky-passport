/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  OPENER_HELLO_GRACE_MS,
  OPENER_KEYCHAIN_FEATURE,
} from "@/client/logic/authorization/opener/OpenerChannel";
import { Result } from "better-result";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import {
  installOpenerChannel,
  takeOpenerChannel,
} from "@/client/logic/authorization/opener/OpenerChannel";
import {
  ValidatedPubkyAuthRequest,
  type AuthorizationRequestReview,
} from "@/client/logic/authorization/request/ValidatedPubkyAuthRequest";
import { requestDigest } from "@/libs/requestDigest";
import { SignInBand } from "./signInBand";
import { AuthorizationReview } from "./review/authorizationReview";
import { useAuthorizationRequester } from "./useAuthorizationRequester";

const SECRET = ["kqnceEMgrNQM_xi06oQXjA3c", "JHX_RQmw1BY6JE1bse8"].join("");
// The package's popup request: no callbacks, so only the bound opener can name the requester.
const REQUEST = `pubkyauth://signin?caps=/pub/example.app/:rw&relay=https://relay.example/inbox&secret=${SECRET}&x-source=Claimed%20App`;
const WITHOUT_CALLBACKS: AuthorizationRequestReview = {
  authenticationMethod: "cookie",
  capabilities: [],
  requesterName: "Claimed App",
};
const WITH_CALLBACKS: AuthorizationRequestReview = {
  ...WITHOUT_CALLBACKS,
  callbackHost: "callback.example",
};
/** M3: what every screen says while nobody verified who asks. */
const UNVERIFIED = /can’t confirm who sent this request/u;
const UNVERIFIED_BAND = { name: "Passport can’t confirm who is asking." };

/** Lets the opener's hello grace run out, as if no bound hello arrived. */
function graceElapses() {
  act(() => {
    vi.advanceTimersByTime(OPENER_HELLO_GRACE_MS);
  });
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  takeOpenerChannel()?.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Installs the channel for REQUEST, as the page entry does before hydration. */
function fixture() {
  const opener = { postMessage: vi.fn() };
  vi.stubGlobal("opener", opener);
  const validated = ValidatedPubkyAuthRequest.fromEncoded(encodeURIComponent(REQUEST));
  if (Result.isError(validated)) throw new Error(validated.error.code);
  installOpenerChannel(window, { status: "valid", request: validated.value });
  const send = (
    origin = "https://real.example:8443",
    request = requestDigest(REQUEST),
    features: readonly string[] = [],
  ) =>
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event("message"), {
          source: opener,
          origin,
          data: {
            type: "pubky-passport.hello",
            version: 2,
            attemptId: "0123456789abcdef",
            features,
            request,
          },
        }),
      );
    });
  return { send, channel: takeOpenerChannel()! };
}

function Screens({ review = WITHOUT_CALLBACKS }: { review?: AuthorizationRequestReview }) {
  return (
    <>
      <SignInBand authorization={{ status: "review", review }} />
      <AuthorizationReview
        review={review}
        phase="review"
        onAuthorize={vi.fn()}
        onCancel={vi.fn()}
        onSwitch={vi.fn()}
      />
    </>
  );
}

/** What a request's start page reads from the hook: whether to leave the keychain line out. */
function KeychainProbe() {
  const { appOffersKeychain, awaitingHello } = useAuthorizationRequester(WITHOUT_CALLBACKS);
  return <p>{`keychain=${appOffersKeychain} awaiting=${awaitingHello}`}</p>;
}

it("says the app offers its own keychain once a hello bound to this request names it", () => {
  vi.useFakeTimers();
  const f = fixture();
  render(<KeychainProbe />);
  // Nothing is known while the hello may still come.
  expect(screen.getByText("keychain=false awaiting=true")).toBeVisible();
  f.send(undefined, undefined, ["outcome-v2", "status", OPENER_KEYCHAIN_FEATURE]);
  expect(screen.getByText("keychain=true awaiting=false")).toBeVisible();
});

it.each([
  ["names no keychain", requestDigest(REQUEST), ["outcome-v2", "status"]],
  ["is for another request", requestDigest(`${REQUEST}&x=1`), [OPENER_KEYCHAIN_FEATURE]],
] as const)("never says the app offers a keychain for a hello that %s", (_, request, features) => {
  vi.useFakeTimers();
  const f = fixture();
  render(<KeychainProbe />);
  f.send(undefined, request, features);
  graceElapses();
  expect(screen.getByText("keychain=false awaiting=false")).toBeVisible();
});

it("says no app offers a keychain on a page without an opener", () => {
  render(<KeychainProbe />);
  expect(screen.getByText("keychain=false awaiting=false")).toBeVisible();
});

it("A39: a hello bound to this request names its opener in the band and drops the no-website line", () => {
  const f = fixture();
  render(<Screens />);
  // The opener's hello has a moment to bind before the page says nobody is named.
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(screen.queryByText(UNVERIFIED)).toBeNull();
  f.send();
  expect(
    screen.getByRole("complementary", { name: "Signing in to real.example:8443" }),
  ).toBeVisible();
  expect(screen.queryByText(UNVERIFIED)).toBeNull();
  // The app's label heads the review; nothing claims browser verification.
  expect(screen.getByRole("heading", { name: "Signing in to Claimed App" })).toBeVisible();
  expect(document.body).not.toHaveTextContent(/verified/iu);
  expect(document.body).not.toHaveTextContent(/given by the app/iu);
  expect(screen.getByRole("button", { name: "Authorize" })).not.toHaveAttribute("aria-describedby");
});

it("says Passport can't confirm who asks once the opener's grace passes without a bound hello", () => {
  vi.useFakeTimers();
  fixture();
  render(<Screens />);
  expect(screen.queryByText(UNVERIFIED)).toBeNull();
  expect(screen.queryByRole("complementary")).toBeNull();
  act(() => {
    vi.advanceTimersByTime(OPENER_HELLO_GRACE_MS - 1);
  });
  expect(screen.queryByText(UNVERIFIED)).toBeNull();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.getByText(UNVERIFIED)).toBeVisible();
  expect(screen.getByRole("complementary", UNVERIFIED_BAND)).toBeVisible();
  // The Authorize button carries the notice as its description.
  const authorize = screen.getByRole("button", { name: "Authorize" });
  expect(authorize).toHaveAccessibleDescription(UNVERIFIED);
});

it("says at once that nobody verified the request when the page has no opener", () => {
  render(<Screens review={WITH_CALLBACKS} />);
  expect(screen.getByText(UNVERIFIED)).toBeVisible();
  // The band names no requester; the callback host is only where the request returns, unverified.
  const band = screen.getByRole("complementary", UNVERIFIED_BAND);
  expect(band).toHaveTextContent("Returns to callback.example (unverified)");
  expect(screen.getByRole("heading", { level: 1 })).toHaveAccessibleName("Sign-in request.");
  expect(screen.queryByText(/Signing in to/u)).toBeNull();
});

it("A40: a hello for another request never names its opener", () => {
  vi.useFakeTimers();
  const f = fixture();
  render(<Screens />);
  f.send("https://attacker.example", requestDigest(`${REQUEST}&x=1`));
  graceElapses();
  expect(screen.getByRole("complementary", UNVERIFIED_BAND)).toBeVisible();
  expect(screen.queryByText(/attacker\.example/u)).toBeNull();
  expect(screen.getByText(UNVERIFIED)).toBeVisible();
  f.send();
  expect(
    screen.getByRole("complementary", { name: "Signing in to real.example:8443" }),
  ).toBeVisible();
});

it("names the opener instead of a foreign callback host and warns in both surfaces", () => {
  const f = fixture();
  render(<Screens review={WITH_CALLBACKS} />);
  // The request's own callback host names nobody while its hello may still arrive.
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(screen.queryByText(/This app asks to return you/u)).toBeNull();
  f.send();
  expect(
    screen.getByRole("complementary", { name: "Signing in to real.example:8443" }),
  ).toBeVisible();
  const warning =
    "This app asks to return you to callback.example, which is not real.example:8443.";
  expect(
    screen.getAllByText(
      (_content, element) => element?.textContent === warning && element.tagName === "P",
    ),
  ).toHaveLength(2);
});

it("never warns for the same origin, even after unrelated binding attempts", () => {
  const f = fixture();
  render(<Screens review={{ ...WITH_CALLBACKS, callbackHost: "real.example:8443" }} />);
  f.send();
  f.send("https://attacker.example");
  expect(screen.queryByText(/This app asks to return you/u)).toBeNull();
});

it.each(["http://localhost:5173", "http://127.0.0.1:5173", "http://[::1]:5173"])(
  "shows a loopback opener as a local development app for %s",
  (origin) => {
    const f = fixture();
    f.send(origin);
    render(<Screens />);
    expect(
      screen.getByRole("complementary", {
        name: `Signing in to Local development app (${origin})`,
      }),
    ).toBeVisible();
    expect(screen.queryByText(UNVERIFIED)).toBeNull();
  },
);

it("names the bound opener on a terminal screen as the request's origin", () => {
  const f = fixture();
  f.send();
  render(<SignInBand authorization={{ status: "cancelled", review: WITHOUT_CALLBACKS }} />);
  expect(
    screen.getByRole("complementary", { name: "Sign-in request from real.example:8443" }),
  ).toBeVisible();
});

it("unsubscribes every surface when unmounted", () => {
  const f = fixture();
  const subscribe = f.channel.subscribe.bind(f.channel);
  const unsubscribers: ReturnType<typeof vi.fn>[] = [];
  vi.spyOn(f.channel, "subscribe").mockImplementation((listener) => {
    const unsubscribe = vi.fn(subscribe(listener));
    unsubscribers.push(unsubscribe);
    return unsubscribe;
  });
  const rendered = render(<Screens />);
  rendered.unmount();
  expect(unsubscribers.length).toBeGreaterThanOrEqual(2);
  for (const unsubscribe of unsubscribers) expect(unsubscribe).toHaveBeenCalledOnce();
  f.send();
});

it("uses the server snapshot without borrowing a browser binding", () => {
  const f = fixture();
  f.send();
  const markup = renderToString(
    <SignInBand authorization={{ status: "review", review: WITH_CALLBACKS }} />,
  );
  expect(markup).toContain("callback.example");
  expect(markup).not.toContain("real.example");
});

it("renders an app-supplied name as isolated text, never markup or links", () => {
  const text = '<img src="https://claim.example/image" onerror="alert(1)">';
  const f = fixture();
  f.send();
  const { container } = render(<Screens review={{ ...WITHOUT_CALLBACKS, requesterName: text }} />);
  for (const element of screen.getAllByText(text)) expect(element.tagName).toBe("BDI");
  expect(container.querySelector('[src="https://claim.example/image"]')).toBeNull();
  expect(container.querySelector('a[href^="https://claim.example"]')).toBeNull();
});
