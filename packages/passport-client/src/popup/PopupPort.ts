import type { PassportInstance } from "../instance/PassportInstance.js";

export interface PopupRequest {
  readonly instance: PassportInstance;
  readonly attemptId: string;
  readonly generation: number;
  readonly authorizationUrl?: string;
  /** Opens Passport's profile setup for this key instead of a request. */
  readonly profileKey?: string;
}
export interface PopupPort {
  open(request: PopupRequest, target?: "named" | "blank"): Window | null | undefined;
  navigate(popup: Window, instance: PassportInstance, authorizationUrl: string): boolean;
  focus(popup: Window): void;
  close(popup: Window): void;
  isClosed(popup: Window): boolean;
  post(popup: Window, message: unknown, origin: string): boolean;
  /** Setup failures throw only to the internal controller; later failures use its callback. */
  watch(popup: Window, closed: () => void, failed?: (cause: unknown) => void): () => void;
  dispose(): void;
}
