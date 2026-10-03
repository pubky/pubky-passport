type Child = Node | string | false | null | undefined;

/** Builds DOM with textContent only: no HTML parsing anywhere in the demo. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string | boolean>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(props)) {
    if (value === false || value === undefined) continue;
    element.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}
