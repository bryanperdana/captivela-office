# Modifications

This repository is a fork of **GenOffice**
(<https://github.com/genspark-ai/genoffice>), Copyright 2026 Mainfunc, Inc.,
licensed under the [Apache License 2.0](LICENSE).

As required by section 4(b) of that license, this file records the changes made
to the original work. The upstream `NOTICE` file is retained unmodified.

The fork is called **Captivela Office**. Its purpose is to run the suite's AI
features against an endpoint the user supplies ("bring your own key") instead
of a hosted Genspark account.

> The GenOffice and Genspark names and logos are trademarks of Mainfunc, Inc.
> The Apache-2.0 license does not grant permission to use them (section 6), so
> this fork carries its own name and marks.

## Phase 1 — BYOK provider configuration

### Added

- `packages/ai-provider/src/byok.ts` — the fork's build switches:
  `PRODUCT_NAME` and `GENSPARK_CLOUD_ENABLED`. The upstream Genspark cloud
  code paths are left intact but gated behind the latter, which is `false`.
- `packages/ai-provider/src/settings.ts` — the settings policy shared by every
  surface: base-URL validation (https everywhere, http only for loopback, no
  embedded credentials), the IPC-boundary validator, custom-instruction
  composition (`composeSystemSuffix`), and secret redaction.
- `packages/ai-provider/src/compat.ts` — the "Test Connection" and "Test Tool
  Calling" checks, which report *which* layer failed (connectivity, auth,
  model, protocol, streaming, tool-calling, config) rather than one opaque
  error.
- `packages/electron-utils/src/ai-settings-store.ts` — the settings store. API
  keys are encrypted with Electron `safeStorage` and never leave the main
  process; the renderer receives only a per-provider "a key is stored" flag.
- `packages/electron-utils/src/ai-ipc-core.ts` — the shared body of the
  `ai:*` settings handlers, so validation, secret resolution and error
  redaction are written once for all four editors.
- `packages/ui/src/AiSettingsDialog.tsx` — the BYOK settings dialog shared by
  docs, sheets, slides and pdf. It reaches the main process only through an
  injected bridge, so each app passes its own preload surface.
- `packages/ui/src/icons.tsx` — `IconAiMark`, a brand-neutral AI mark, and
  `IconAiSettings`.
- Tests: `packages/ai-provider/tests/{settings,compat}.test.ts` and
  `packages/electron-utils/tests/ai-settings-store.test.ts`.

### Changed

- **Provider routing.** `packages/ai-provider` gained OpenAI-compatible
  presets (OpenAI, OpenRouter, Ollama, LiteLLM, DeepSeek, custom) alongside
  the upstream Anthropic/Genspark paths. Fresh installs default to the
  `openai` preset with no key rather than to Genspark.
- **Key handling.** The renderer no longer sends an API key with each chat or
  stream request; the main process resolves it from the encrypted store. Error
  text returned to a renderer is passed through `redactSecrets` first.
- **Custom instructions.** Global and per-app instructions from the settings
  dialog are appended to every skill's system prompt via `composeSystemSuffix`,
  after the language directive, in all four editors.
- **Genspark account.** `ai:gsk-status` reports signed out and `ai:gsk-login`
  is a no-op while `GENSPARK_CLOUD_ENABLED` is `false`, so no AI feature can be
  gated on a Genspark login. The inline sign-in buttons and the shell home's
  account/login rows are not rendered.
- **Branding.** The Genspark brand mark and the visible "Genspark" / "Genspark
  AI" labels in the AI panels, collapsed rails and ribbon AI groups were
  replaced with the neutral `IconAiMark` and "AI". The shell's product
  metadata is now `Captivela Office` / `com.captivela.office` (Linux executable and
  desktop entry: `captivela-office`).
- **Packaging** (`apps/shell/electron-builder.cjs`). The Genspark `gsk` CLI is
  no longer copied into `extraResources` and its hoisting preflight is gone —
  nothing in the package would run it. macOS builds are unsigned and
  un-notarized by default; set `CAPTIVELA_OFFICE_RELEASE_SIGNING=1` to restore
  signing, the hardened runtime and notarization for a release build.

### Not changed

The document engines (`docx-engine`, `pptx-engine`, `pptx-render`,
`file-parse`), the agent loop (`agent-core`), and the editors' own UI and file
round-trip behaviour are upstream code, carried unmodified apart from the AI
panel wiring described above.
