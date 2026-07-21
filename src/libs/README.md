# Shared Libraries

Small shared utilities: environment parsing, bounded request bodies, redaction, and
logging. They provide mechanics, not product flows or integrations.

`env/server.ts` is server-only; browser code may use only `env/public.ts`. Logger
output is redacted, but callers must still use safe event names and error codes.
