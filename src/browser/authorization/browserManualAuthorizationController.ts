import "client-only";

export type ManualAuthorizationEntryResult = "invalid" | "navigating";

export type BrowserManualAuthorizationController = {
  enter(rawRequest: string): ManualAuthorizationEntryResult;
};
