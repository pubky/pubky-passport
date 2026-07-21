# Server Adapters

Server adapters start with `import "server-only"`. They may use server SDKs,
Homegate HTTP, and server secrets, but must never import browser adapters or
public browser configuration.
