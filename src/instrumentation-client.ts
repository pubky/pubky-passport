// Next.js evaluates this framework entrypoint before React hydration. Initialize the
// client-only authorization capture here so sensitive URL fragments are scrubbed early.
import "./client/logic/authorization/entry/authorizationEntryBootstrap";
