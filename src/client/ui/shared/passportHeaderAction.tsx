"use client";

import { type ReactNode, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

const PASSPORT_HEADER_ACTIONS_ID = "passport-header-actions";
const subscribe = () => () => {};
const getContainer = () => document.getElementById(PASSPORT_HEADER_ACTIONS_ID);
const getServerContainer = () => null;

/** The shared header slot that screens fill through `PassportHeaderAction`. */
export function PassportHeaderActionSlot() {
  return <div id={PASSPORT_HEADER_ACTIONS_ID} className="flex shrink-0 items-center gap-3" />;
}

/** Places a screen's actions in the shared header for the lifetime of that screen. */
export function PassportHeaderAction({ children }: { children: ReactNode }) {
  const container = useSyncExternalStore(subscribe, getContainer, getServerContainer);
  return container ? createPortal(children, container) : children;
}
