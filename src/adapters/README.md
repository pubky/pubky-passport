# Adapters

Adapters integrate a concrete runtime system with a feature-local core contract.
They contain Google, Drive, WebCrypto, Pubky SDK, Homegate HTTP, and server-secret
details. They do not choose which adapters form a running feature; that belongs in
`src/composition`.
