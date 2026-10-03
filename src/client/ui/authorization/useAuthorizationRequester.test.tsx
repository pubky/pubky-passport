/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import { OPENER_HELLO_GRACE_MS } from "@/client/logic/authorization/opener/OpenerChannel";
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
const NO_WEBSITE = /doesn.t name a website/u;

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
  const send = (origin = "https://real.example:8443", request = requestDigest(REQUEST)) =>
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event("message"), {
          source: opener,
          origin,
          data: {
            type: "pubky-passport.hello",
            version: 2,
            attemptId: "0123456789abcdef",
            features: [],
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

it("A39: a hello bound to this request names its opener in the band and drops the no-website line", () => {
  const f = fixture();
  render(<Screens />);
  // The opener's hello has a moment to bind before the page says nobody is named.
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(screen.queryByText(NO_WEBSITE)).toBeNull();
  f.send();
  expect(
    screen.getByRole("complementary", { name: "Signing in to real.example:8443" }),
  ).toBeVisible();
  expect(screen.queryByText(NO_WEBSITE)).toBeNull();
  // The app's label heads the review; nothing claims browser verification.
  expect(screen.getByRole("heading", { name: "Signing in to Claimed App" })).toBeVisible();
  expect(document.body).not.toHaveTextContent(/verified/iu);
  expect(document.body).not.toHaveTextContent(/given by the app/iu);
  expect(screen.getByRole("button", { name: "Authorize" })).not.toHaveAttribute("aria-describedby");
});

it("says the request names no website once the opener's grace passes without a bound hello", () => {
  vi.useFakeTimers();
  fixture();
  render(<Screens />);
  expect(screen.queryByText(NO_WEBSITE)).toBeNull();
  act(() => {
    vi.advanceTimersByTime(OPENER_HELLO_GRACE_MS - 1);
  });
  expect(screen.queryByText(NO_WEBSITE)).toBeNull();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(screen.getByText(NO_WEBSITE)).toBeVisible();
  expect(screen.getByRole("button", { name: "Authorize" })).toHaveAttribute("aria-describedby");
});

it("shows the no-website line at once when the page has no opener", () => {
  render(<Screens />);
  expect(screen.getByText(NO_WEBSITE)).toBeVisible();
});

it("A40: a hello for another request never names its opener", () => {
  vi.useFakeTimers();
  const f = fixture();
  render(<Screens />);
  f.send("https://attacker.example", requestDigest(`${REQUEST}&x=1`));
  graceElapses();
  expect(screen.queryByRole("complementary")).toBeNull();
  expect(screen.getByText(NO_WEBSITE)).toBeVisible();
  f.send();
  expect(
    screen.getByRole("complementary", { name: "Signing in to real.example:8443" }),
  ).toBeVisible();
});

it("names the opener instead of a foreign callback host and warns in both surfaces", () => {
  const f = fixture();
  render(<Screens review={WITH_CALLBACKS} />);
  expect(
    screen.getByRole("complementary", { name: "Signing in to callback.example" }),
  ).toBeVisible();
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
    expect(screen.queryByText(NO_WEBSITE)).toBeNull();
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
