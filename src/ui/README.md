# UI

Contains Passport screen components and safe display state. Keep components local to
their screen until real reuse warrants `components/`.

UI renders parsed review data, public identities, progress, and typed errors. It
never holds credentials, key material, raw authorization URLs, callback URLs, or
ciphertext. Client components may use browser flows, never server code.
