import "client-only";

/**
 * What one read-only look for Pubky Ring's answer found: the answer (`answered`), no answer yet
 * (`waiting`), or no usable reply from the server asked (`unreachable`).
 */
export type RingAnswerLook = "answered" | "waiting" | "unreachable";

/** The usual wait between looks, and the longest one while the server gives no usable reply. */
export type RingAnswerWatchPace = Readonly<{ intervalMs: number; maxIntervalMs: number }>;

/** Whether the page is in view, and when that changes; `document` in the browser. */
export type PageVisibility = {
  isVisible: () => boolean;
  /** Calls `listener` on every change and returns a function that stops. */
  subscribe: (listener: () => void) => () => void;
};

/** Runs `callback` after `delayMs` and returns a function that cancels it. */
export type Scheduler = (callback: () => void, delayMs: number) => () => void;

export type RingAnswerWatchOptions = { page?: PageVisibility; schedule?: Scheduler };

const scheduleTimeout: Scheduler = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
};

/** The document's visibility; without a document (no browser) the page counts as always shown. */
function documentVisibility(): PageVisibility {
  if (typeof document === "undefined")
    return { isVisible: () => true, subscribe: () => () => undefined };
  return {
    isVisible: () => document.visibilityState !== "hidden",
    subscribe: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}

/**
 * Looks for Pubky Ring's answer with `look` while the page is in view, so a screen waiting for Ring
 * can go on by itself; `onAnswered` then runs once and watching ends. The first look waits one
 * interval, since Ring needs time to be used. A look without a usable reply (`unreachable`) doubles
 * the wait before the next, up to `maxIntervalMs`, and any real reply returns to `intervalMs`. A
 * hidden page is not looked for: a phone that switched to Ring pauses, and coming back looks at
 * once, when the answer is most likely there. `look` must only read; it may run many times, and one
 * that throws counts as `unreachable`. Returns a function that stops watching and aborts a look
 * still under way.
 */
export function watchForRingAnswer(
  look: (signal: AbortSignal) => Promise<RingAnswerLook>,
  onAnswered: () => void,
  { intervalMs, maxIntervalMs }: RingAnswerWatchPace,
  { page = documentVisibility(), schedule = scheduleTimeout }: RingAnswerWatchOptions = {},
): () => void {
  const lookups = new AbortController();
  let delayMs = intervalMs;
  let cancelTimer: (() => void) | undefined;
  let looking = false;

  const pause = () => {
    cancelTimer?.();
    cancelTimer = undefined;
  };
  const scheduleNext = () => {
    if (lookups.signal.aborted || looking || cancelTimer || !page.isVisible()) return;
    cancelTimer = schedule(() => {
      cancelTimer = undefined;
      void lookOnce();
    }, delayMs);
  };
  async function lookOnce(): Promise<void> {
    if (lookups.signal.aborted || looking || !page.isVisible()) return;
    looking = true;
    let found: RingAnswerLook;
    try {
      found = await look(lookups.signal);
    } catch {
      found = "unreachable";
    }
    looking = false;
    if (lookups.signal.aborted) return;
    if (found === "answered") {
      stop();
      onAnswered();
      return;
    }
    delayMs = found === "unreachable" ? Math.min(delayMs * 2, maxIntervalMs) : intervalMs;
    scheduleNext();
  }
  const unsubscribe = page.subscribe(() => {
    pause();
    if (page.isVisible()) void lookOnce();
  });
  function stop(): void {
    lookups.abort();
    pause();
    unsubscribe();
  }

  scheduleNext();
  return stop;
}
