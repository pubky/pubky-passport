# Shared Libraries

Small shared mechanisms only: bounded HTTP bodies and redacted logging. Product
policy and deployment configuration live with their core or runtime owner.

`http/` owns cross-runtime body reading, and `logger/` owns both formatting and
mandatory redaction. Callers must still use safe event names and error codes.
