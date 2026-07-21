# Google Server Integration

This folder verifies Google ID tokens for Passport server-owned operations such as
wrapping-key derivation. Verification checks issuer, audience, authorized party,
expiry, and subject before Passport uses the resulting identity.

Google ID tokens and subjects are sensitive. This code returns typed verification
outcomes and must not log token values, raw subjects, or provider error payloads.
