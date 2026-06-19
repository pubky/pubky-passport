# Engineering Quality Strategy

## Repository Interpretation

- Authors must self-review before PR.
- PRs must stay small and focused.
- No self-merge.
- Do not merge on failing CI unless risk is explicitly accepted and documented.
- Reviewers must run the change when practical, not only read the diff.
- Issues must include enough detail, acceptance criteria, and validation context.
- Bug fixes need reproduction validation and regression tests where practical.
- Features need validation against agreed product/design context.
- Tests are product quality signals.
- Flaky tests are owned product issues.
- CI failures must be understood before merge.
- AI assistance does not replace human accountability.

## Passport-Specific Quality Bar

- Preserve clean architecture boundaries in every PR.
- Keep security-sensitive flows small enough to review deeply.
- Treat redaction, callback validation, and key-handling behavior as product requirements, not implementation details.
- Prefer fake ports in application tests over live network calls.
- Verify concrete Pubky SDK APIs before coding against them.
- Add tests for parser, validation, and error mapping before integrating UI or adapters.
