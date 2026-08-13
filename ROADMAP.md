# Captivela Office Roadmap

Captivela Office is currently an unsigned developer preview. This roadmap communicates direction, not delivery dates or promises. Priorities may change as compatibility evidence and community feedback improve.

## Now

- Distribute the v0.5.0 preview with explicit unsigned-binary warnings, checksums, and reproducible release evidence.
- Improve DOCX, XLSX/XLS/CSV, PPTX, and PDF open/edit/save reliability.
- Expand round-trip fixtures and regression tests for files created by common office applications.
- Document known compatibility limits and collect minimal, redacted reproduction files.
- Keep BYOK provider settings and Electron process boundaries testable and reviewable.

## Next

- Add Windows code signing and macOS Developer ID signing/notarization.
- Run clean-machine installation and acceptance checks across supported Windows x64 and macOS Apple Silicon versions.
- Polish navigation, editor states, provider setup, error messages, and accessibility.
- Expand file-format compatibility based on reproducible issues and fidelity tests.
- Harden release automation, update delivery, and rollback procedures before a stable channel.

## Later

- Evaluate additional operating-system and hardware targets when maintainable build and QA coverage exists.
- Explore collaboration or interoperability features only with a clear privacy model and sustainable maintenance plan.
- Consider optional advanced modules without weakening the Apache-2.0 open-source core or the `ee/` license boundary.

## Shape the roadmap

Before opening a request, search [existing issues](https://github.com/bryanperdana/captivela-office/issues). New issues are welcome when they describe the user problem, affected format and originating application, expected behavior, and a minimal non-confidential example where possible.

A roadmap item is not a commitment. Implementation still depends on design review, security impact, compatibility evidence, tests, and maintainer capacity. See [CONTRIBUTING.md](CONTRIBUTING.md) to propose or implement a focused change.
