# Browser Composition

Browser composition starts with `import "client-only"` and creates browser feature
object graphs. It is the only acceptable wiring point for a flow that needs both
the encrypted Drive file and the wrapping-key API response; neither value may be
persisted or sent to server code.
