# UI Features

Feature folders group Passport-owned screen components by product area: authorize,
setup, dashboard, and settings. Keep components close to the screen state they
render; create a shared component only after it has real reuse across features.

Feature UI consumes safe view models and typed progress or error states. It must not
hold Google tokens, Drive tokens, wrapping keys, decrypted identity material, raw
Pubky authorization URLs, or full callback URLs in React state.
