const GAP = 8;
const EDGE = 8;

/**
 * The element's popover: it floats below the button over the page, so the element never takes
 * more room than its button. In the browser's top layer it is never clipped or covered; without
 * the Popover API it sits just below the host (whose `:host` is positioned).
 */
export class Tray {
  readonly element: HTMLDivElement;
  #anchor: HTMLElement | undefined;
  #open = false;
  readonly #topLayer: boolean;
  #stop: (() => void) | undefined;

  constructor(
    private readonly host: HTMLElement,
    private readonly dismiss: () => void,
  ) {
    const element = host.ownerDocument.createElement("div");
    element.className = "tray";
    element.setAttribute("part", "tray");
    element.setAttribute("role", "group");
    this.#topLayer = typeof element.showPopover === "function";
    if (this.#topLayer) element.setAttribute("popover", "manual");
    else element.hidden = true;
    this.element = element;
  }

  get open(): boolean {
    return this.#open;
  }

  /** Shows `content` below `anchor`, or updates it in place when already open. */
  show(anchor: HTMLElement, label: string, content: Node[]): void {
    // A host that left the document has nothing to float over; it renders again when it returns.
    if (!this.host.isConnected) return this.hide();
    this.#anchor = anchor;
    this.element.setAttribute("aria-label", label);
    this.element.replaceChildren(...content);
    if (!this.#open) {
      this.#open = true;
      if (this.#topLayer) {
        try {
          this.element.showPopover();
        } catch {
          /* Not in a document yet: positioned below the host instead. */
        }
      } else this.element.hidden = false;
      this.#listen();
    }
    this.#place();
  }

  hide(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#stop?.();
    this.#stop = undefined;
    this.element.replaceChildren();
    if (this.#topLayer) {
      try {
        this.element.hidePopover();
      } catch {
        /* Already hidden, for example after the host left the document. */
      }
    } else this.element.hidden = true;
  }

  /** Top layer: fixed below the anchor, kept inside the viewport and following scrolls. */
  #place(): void {
    if (!this.#topLayer || !this.#anchor) return;
    const view = this.host.ownerDocument.defaultView;
    if (!view) return;
    const anchor = this.#anchor.getBoundingClientRect();
    const width = this.element.offsetWidth;
    const room = view.innerWidth - EDGE - width;
    // Start at the button's left edge; near the right edge, end at the button's right edge.
    const left = anchor.left <= room ? anchor.left : anchor.right - width;
    this.element.style.setProperty("left", `${Math.max(EDGE, Math.min(left, room))}px`);
    this.element.style.setProperty("top", `${anchor.bottom + GAP}px`);
  }

  #listen(): void {
    const document = this.host.ownerDocument;
    const view = document.defaultView;
    const outside = (event: Event) => {
      if (!event.composedPath().includes(this.host)) this.dismiss();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") this.dismiss();
    };
    const place = () => this.#place();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    view?.addEventListener("scroll", place, { capture: true, passive: true });
    view?.addEventListener("resize", place);
    this.#stop = () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
      view?.removeEventListener("scroll", place, { capture: true });
      view?.removeEventListener("resize", place);
    };
  }
}
