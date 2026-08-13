# Contributing to Captivela Office

Thank you for helping improve Captivela Office. This guide covers the normal fork-and-pull-request workflow, local setup, required checks, and the file-fidelity standards used in this repository.

## Contribution workflow

1. Search existing issues and pull requests before starting substantial work.
2. Fork `bryanperdana/captivela-office` on GitHub and clone your fork.
3. Create a focused branch from the current `main` branch.
4. Make the change, add appropriate tests, and run the checks below.
5. Push the branch to your fork and open a pull request against this repository's `main` branch.

Do not push directly to `main`. A pull request should explain the problem, the approach, user-visible effects, and any checks that were not run. Maintainers may ask for a smaller scope or additional compatibility evidence before merging.

## Repository layout

- `apps/docs`, `apps/sheets`, `apps/slides`, `apps/pdf` — Electron editors with main-process, preload, renderer, and test code.
- `apps/shell` — suite home screen, tab host, updater surface, and installer packaging entry point.
- `packages/*` — format engines and shared TypeScript packages for AI, UI, localization, project storage, and Electron utilities.
- `apps/sheets/native/xlsx-engine` — Rust XLSX import/export sidecar.
- `ee/` — separately licensed boundary reserved for future enterprise modules; external contributions must not modify it.

## Getting started

Prerequisites:

- Node.js 20
- npm 10 or newer
- Rust stable with `cargo` on `PATH` for the Sheets XLSX sidecar

```bash
git clone https://github.com/YOUR-USERNAME/captivela-office.git
cd captivela-office
npm ci
npm run fixtures
npm run dev
```

Use `npm ci`, not `npm install`, for a deterministic install from the committed lockfile. `npm run dev:docs` runs only Captivela Docs; equivalent workspace commands can be used for the other editors.

## Checks every change must pass

Run the repository checks from the root under Node 20:

```bash
npm run format:check # Prettier check for changed and new files
npm run licenses     # production dependency license allowlist
npm run lint         # ESLint; zero errors required
npm run audit:brand  # user-visible Captivela branding audit
npm run typecheck    # tsc --noEmit across every workspace
npm run fixtures     # regenerate deterministic DOCX fixtures
npm test             # engine, app, and Rust sidecar tests
```

After regenerating fixtures, confirm that committed fixtures did not drift unexpectedly:

```bash
git diff --exit-code -- fixtures/generated
```

Formatting is intentionally incremental. Run these exact commands as applicable:

```bash
npm run format                              # format uncommitted changed/new files
npm run format:check                        # verify uncommitted changed/new files
npm run format:check -- --base origin/main  # verify committed files on your branch
```

Changes to Sheets import/export must also pass its compatibility gate:

```bash
npm run fixtures -w @genoffice/sheets
npm run compat -w @genoffice/sheets
```

Changes affecting the Electron shell or cross-app behavior should run:

```bash
npm run build:all
npm run test:e2e
```

CI additionally checks Rust dependency licenses with `cargo deny`. If your change adds or updates Rust dependencies, run `cargo deny check licenses --manifest-path apps/sheets/native/xlsx-engine/Cargo.toml` locally when `cargo-deny` is available.

## Building installers

Run packaging commands from the repository root. They regenerate third-party notices and build all five applications before packaging:

```bash
npm run dist:mac   # DMG + ZIP on macOS
npm run dist:win   # NSIS installer on Windows
```

Contributor packages are unsigned unless release-signing credentials are explicitly configured. Unsigned artifacts are developer builds and must not be represented as trusted public releases.

### Windows x64/MSVC contract

The authoritative Windows package is built on Windows with Rust stable targeting `x86_64-pc-windows-msvc`. The repository workflow in [`.github/workflows/windows-build.yml`](.github/workflows/windows-build.yml) uses this sequence:

```bash
npm ci
npm run test:win:packaging
npm run native:build:win-x64 -w @genoffice/sheets
npm run notices
npm run build:all
npm run verify:win:inputs
npm run dist:win -w @genoffice/shell
```

The native build must produce the x64 MSVC Sheets sidecar expected by the packaging input check. Do not substitute the MinGW `x86_64-pc-windows-gnu` target or manually copy a binary into a different target directory. The workflow then runs `tools/qa-windows-package.ps1` against the packaged runtime and installer.

Signed release runs fail closed when Authenticode credentials are missing or a signature is invalid. Normal contributor runs are expected to remain unsigned.

## Configuration and secrets

No credentials are required to build the editors or run the non-provider test suite. AI features use user-configured OpenAI-compatible provider settings.

- Never commit API keys, access tokens, credentials, or private document fixtures.
- API keys must remain behind the existing main-process settings boundary: encrypted through Electron `safeStorage`, resolved in the main process, and represented to renderers only by a stored-key marker.
- Use `GENOFFICE_USER_DATA` only as the existing test/development override for Electron user-data isolation.
- `XLSX_SIDECAR_PATH`, `XLSX_OPEN_PATH`, and `XLSX_DEBUG_PORT` are local sidecar development overrides.
- `*_DEV_PORT` and `*_RENDERER_URL` are per-app development server overrides normally set by `npm run dev`.

## Coding conventions

- Use English in code, comments, commit messages, and documentation. User-facing translations belong in the existing i18n resources.
- Prefer precise TypeScript types; do not add an `any` surface when a useful type is practical.
- Put tests in `apps/*/tests` or `packages/*/tests`. New engine behavior requires focused tests.
- Keep Electron privilege boundaries intact: renderer code must not gain Node.js access or bypass typed, validated IPC.
- Put local Playwright/Electron acceptance drivers in `scripts/drivers/`; see [`scripts/drivers/README.md`](scripts/drivers/README.md).
- The optional Word-fidelity scripts require macOS, Microsoft Word, and AppleScript automation permission. They do not run in CI.
- Prefer a new module when adding a substantial concern to an already-large file.

## File-format fidelity expectations

File compatibility and preservation are core project goals.

- Changes to DOCX, XLSX/XLS/CSV, or PPTX open/save paths must include a round-trip test.
- Prove that untouched package entries or content survive unchanged where the engine contract promises preservation.
- Include the smallest non-confidential fixture that reproduces a compatibility issue.
- Test in the originating office application when the change depends on application-specific behavior, and document what was tested.
- For visible renderer changes, attach before/after screenshots or a short recording using representative content.

Do not make broad compatibility claims from a single fixture or screenshot.

## Commits and pull requests

- Keep commits small and focused, with imperative English subjects such as `fix docx table border round trip`.
- Avoid unrelated reformatting or generated-file churn.
- Link the relevant issue when one exists.
- Complete the pull request template and list exact validation commands and results.
- Clearly identify platform-specific changes and any platform you could not test.

## Bugs, features, and security reports

Use the repository's issue templates for public bug reports and feature requests. Redact private content from sample files, screenshots, and logs.

Do **not** open a public issue for a suspected vulnerability. Follow [SECURITY.md](SECURITY.md) and use the private reporting channel.

## Code of conduct and licensing

All project community spaces follow the [Contributor Covenant](CODE_OF_CONDUCT.md).

There is no contributor license agreement. By contributing, you agree that your contribution is licensed under the [Apache License 2.0](LICENSE) that covers the open-source project. The `ee/` directory has a [separate license](ee/LICENSE), does not accept external contributions, and remains protected by [CODEOWNERS](.github/CODEOWNERS).
