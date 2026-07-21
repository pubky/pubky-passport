# Browser Identity Dependencies

These contracts describe browser identity capabilities: encrypted Passport-file
storage and crypto plus Pubky identity operations. They intentionally contain no
Google, Drive, WebCrypto, or Pubky SDK imports, even though the concrete browser
implementations live beside them.

Keep a new contract here only when browser identity code consumes it. Server
verification, rate limiting, and wrapping-key derivation belong in `src/server`.
