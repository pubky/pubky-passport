type IdentitySelectionState = { view: "selection" } | { view: "add-identity" };

type IdentitySelectionEvent =
  | { type: "add-requested" }
  | { type: "add-cancelled" };

function transitionIdentitySelection(
  state: IdentitySelectionState,
  event: IdentitySelectionEvent,
): IdentitySelectionState {
  switch (event.type) {
    case "add-requested":
      return state.view === "selection" ? { view: "add-identity" } : state;
    case "add-cancelled":
      return state.view === "add-identity" ? { view: "selection" } : state;
  }
}

export {
  transitionIdentitySelection,
  type IdentitySelectionEvent,
  type IdentitySelectionState,
};
