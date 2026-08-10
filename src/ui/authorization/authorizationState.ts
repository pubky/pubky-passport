type AuthorizationViewState =
  | { view: "review" }
  | { view: "identity-selection" };

type AuthorizationViewEvent =
  | { type: "switch-requested" }
  | { type: "selection-finished" };

function transitionAuthorizationView(
  state: AuthorizationViewState,
  event: AuthorizationViewEvent,
): AuthorizationViewState {
  switch (event.type) {
    case "switch-requested":
      return state.view === "review" ? { view: "identity-selection" } : state;
    case "selection-finished":
      return state.view === "identity-selection" ? { view: "review" } : state;
  }
}

export {
  transitionAuthorizationView,
  type AuthorizationViewEvent,
  type AuthorizationViewState,
};
