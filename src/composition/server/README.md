# Server Composition

Server composition starts with `import "server-only"` and creates server route
object graphs. It may read server configuration and select server adapters, but it
must not import browser adapters or receive browser key material or Drive tokens.
