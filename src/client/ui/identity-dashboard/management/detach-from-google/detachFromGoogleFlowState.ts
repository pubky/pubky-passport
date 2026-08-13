type DetachFromGoogleFlowState =
  | { view: "backup" }
  | { view: "encrypted-backup" }
  | { view: "pubky-ring"; migrationUrl: string | null }
  | { view: "review"; confirmation: "closed" | "open" };

type DetachFromGoogleFlowEvent =
  | { type: "backup-requested" }
  | { type: "migration-requested"; migrationUrl: string | null }
  | { type: "backup-confirmed" }
  | { type: "confirmation-requested" }
  | { type: "confirmation-closed" }
  | { type: "back-to-backup" };

function transitionDetachFromGoogleFlow(
  state: DetachFromGoogleFlowState,
  event: DetachFromGoogleFlowEvent,
): DetachFromGoogleFlowState {
  switch (event.type) {
    case "backup-requested":
      return state.view === "backup" ? { view: "encrypted-backup" } : state;
    case "migration-requested":
      return state.view === "backup" ? { view: "pubky-ring", migrationUrl: event.migrationUrl } : state;
    case "backup-confirmed":
      return state.view === "backup" ? { view: "review", confirmation: "closed" } : state;
    case "confirmation-requested":
      return state.view === "review" ? { view: "review", confirmation: "open" } : state;
    case "confirmation-closed":
      return state.view === "review" ? { view: "review", confirmation: "closed" } : state;
    case "back-to-backup":
      return state.view === "backup" ? state : { view: "backup" };
  }
}

export {
  transitionDetachFromGoogleFlow,
  type DetachFromGoogleFlowEvent,
  type DetachFromGoogleFlowState,
};
