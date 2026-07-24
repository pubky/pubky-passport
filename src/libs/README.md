# Shared Libraries

Small shared mechanisms only: public environment parsing, bounded HTTP bodies, and
redacted logging. Product policy and provider-owned configuration live with their
core or runtime owner.

`env/public-env.ts` exposes only validated `NEXT_PUBLIC_*` values. `http/` owns
cross-runtime body reading, and `logger/` owns both formatting and mandatory
redaction. Callers must still use safe event names and error codes.
