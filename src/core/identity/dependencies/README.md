# Identity Dependencies

These contracts describe what identity flows need from the outside world:
wrapping-key verification, encrypted Passport-file storage and crypto, and Pubky
identity operations. They intentionally contain no Google, Drive, WebCrypto, or
Pubky SDK imports.

Keep a new contract here only when an identity flow consumes it. Do not turn this
folder into a general application-wide service registry.
