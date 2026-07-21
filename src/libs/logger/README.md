# Logging

Passport logging goes through this folder so the redaction utility is always applied
before data reaches the console sink. Logging is for stable event names, safe error
codes, and redacted display context, not for debugging raw requests.

Never log Google tokens, Drive tokens, private keys, wrapping material, Pubky auth
request secrets, ciphertext, raw provider subjects, full authorization URLs, or
callback URLs with query parameters or fragments.
