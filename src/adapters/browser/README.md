# Browser Adapters

Browser adapters start with `import "client-only"`. They may use browser APIs,
Google Drive access tokens, WebCrypto, and the Pubky browser SDK, but must never
import server adapters or server environment configuration.
