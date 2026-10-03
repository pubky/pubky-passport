/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestContextBand } from "./requestContextBand";

const property = "--passport-context-band-height";
let height = 34;
let notify: () => void;
const observe = vi.fn();
const disconnect = vi.fn();

beforeEach(() => {
  height = 34;
  observe.mockClear();
  disconnect.mockClear();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, 375, height),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        notify = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
});
afterEach(() => {
  cleanup();
  document.body.style.removeProperty(property);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("reserves the measured height for a growing warning and returns to the compact row", () => {
  const view = render(
    <RequestContextBand
      label="Signing in to"
      requester="app.example"
      notice={<p>Foreign callback</p>}
    />,
  );
  const band = screen.getByRole("complementary", { name: "Signing in to app.example" });
  expect(observe).toHaveBeenCalledExactlyOnceWith(band);
  expect(document.body.style.getPropertyValue(property)).toBe("34px");
  height = 97.25;
  notify();
  expect(document.body.style.getPropertyValue(property)).toBe("98px");
  expect(screen.getByText("Foreign callback").parentElement).not.toContainElement(
    screen.getByTitle("app.example"),
  );
  height = 34;
  view.rerender(<RequestContextBand label="Signing in to" requester="app.example" />);
  expect(document.body.style.getPropertyValue(property)).toBe("34px");
  expect(screen.queryByText("Foreign callback")).toBeNull();
  view.unmount();
  expect(document.body.style.getPropertyValue(property)).toBe("");
});

it("restores an earlier inline offset and rejects resize callbacks after unmount", () => {
  document.body.style.setProperty(property, "12px", "important");
  const view = render(<RequestContextBand label="Signing in to" requester="app.example" />);
  const late = notify;
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
  height = 99;
  late();
  expect(document.body.style.getPropertyValue(property)).toBe("12px");
  expect(document.body.style.getPropertyPriority(property)).toBe("important");
});

it("does not overwrite a later owner's inline offset during cleanup", () => {
  const view = render(<RequestContextBand label="Signing in to" requester="app.example" />);
  document.body.style.setProperty(property, "100px");
  view.unmount();
  expect(document.body.style.getPropertyValue(property)).toBe("100px");
});

it("measures on window resize without ResizeObserver and removes the fallback listener", () => {
  vi.stubGlobal("ResizeObserver", undefined);
  const view = render(<RequestContextBand label="Signing in to" requester="app.example" />);
  height = 74;
  window.dispatchEvent(new Event("resize"));
  expect(document.body.style.getPropertyValue(property)).toBe("74px");
  view.unmount();
  height = 108;
  window.dispatchEvent(new Event("resize"));
  expect(document.body.style.getPropertyValue(property)).toBe("");
});

const HOST = "accounts.google.com.sign-in.secure-verify.attacker.example";

describe("RequestContextBand host display", () => {
  it("keeps the full host in its accessible name and title", () => {
    render(<RequestContextBand label="Signing in to" requester={HOST} />);

    expect(
      screen.getByRole("complementary", { name: `Signing in to ${HOST}` }),
    ).toBeInTheDocument();
    expect(screen.getByTitle(HOST)).toHaveTextContent(HOST);
  });

  it("cuts a long host at its start so the registrable domain stays visible", () => {
    render(<RequestContextBand label="Signing in to" requester={HOST} />);

    const clip = screen.getByTitle(HOST);
    expect(clip).toHaveClass("truncate");
    expect(clip).toHaveAttribute("dir", "rtl");
    // The host itself still reads left to right inside the right-to-left clip.
    expect(clip.querySelector("bdi")).toHaveAttribute("dir", "ltr");
    expect(screen.getByText("Signing in to")).not.toHaveClass("truncate");
  });
});
