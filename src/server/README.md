# Server Runtime

This folder contains server-only Passport feature implementation. Every production
module starts with `import "server-only"` and may use server SDKs, Homegate HTTP,
server secrets, and server environment configuration.

Server flows receive only the minimum values required by their server-owned
operation. They must never import `src/browser`, receive Google Drive access tokens
or encrypted Passport files, or accept decrypted Pubky keys or browser-local
wrapping material.
