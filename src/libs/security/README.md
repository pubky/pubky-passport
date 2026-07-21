# Security Utilities

This folder contains low-level, reusable security helpers: bounded body reads,
secret validation, and redaction. These utilities enforce mechanical safeguards but
do not define feature policy or make logging sensitive data acceptable.

Callers should prefer typed errors and safe metadata over raw values. New helpers
belong here only when they are runtime-agnostic and genuinely shared by multiple
features or boundaries.
