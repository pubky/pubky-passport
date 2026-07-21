# Test Utilities

This folder contains test-only helpers, feature fakes, and architecture checks.
Fakes implement the same safe behavior shapes used by feature flows while recording
only non-sensitive metadata. They must not retain tokens, key bytes, wrapping
material, ciphertext, signup codes, or raw authorization URLs.

The architecture tests enforce import and runtime-marker boundaries. Update those
tests whenever an intentional top-level boundary changes so the documented design
remains executable in CI.
