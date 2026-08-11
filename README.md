# Captivela Office

Captivela Office is an open-source, AI-native office suite for macOS and
Windows. It combines document, spreadsheet, presentation, and PDF tools in one
Electron application and supports user-configured OpenAI-compatible providers.

This project is a rebranded fork of
[GenOffice](https://github.com/genspark-ai/genoffice). See
[MODIFICATIONS.md](MODIFICATIONS.md) for the fork history and material changes.

> **Developer preview:** version 0.5.0 is intended for developers and technical
> early adopters. Current installers are unsigned. The Windows build has passed
> native package/runtime QA, but neither platform should yet be presented as a
> trusted consumer release.

## Download and installation

Release artifacts should be downloaded only from this repository's GitHub
Releases page. Verify the published SHA-256 value before bypassing an operating
system warning.

- Windows x64: `Captivela Office Setup <version>.exe`
- macOS Apple Silicon: `Captivela Office-<version>-arm64.dmg`

See [INSTALLATION.md](INSTALLATION.md) for Windows SmartScreen guidance, macOS
DMG integrity checks, and the narrowly scoped workaround for an intact but
unsigned macOS application. Checksums for verified artifacts are recorded in
[RELEASES.md](RELEASES.md).

## Apps

| App           | Product              | What it is                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/docs`   | **Captivela Docs**   | `.docx` word processor. Byte-preserving round trip: only dirty paragraphs are regenerated (paragraph patch), everything else in the original file is kept byte-for-byte, so opening and saving never breaks layout in Word. Paginated view whose line metrics reproduce the original document's layout, tracked changes, comments, styles, equations, ink.    |
| `apps/sheets` | **Captivela Sheets** | `.xlsx` spreadsheet. UI built on the open-source [Univer](https://github.com/dream-num/univer) core (Apache-2.0) with a large layer of in-house extensions; `.xlsx` import/export runs through an in-house Rust sidecar (calamine + IronCalc), charts are rendered in-house (Konva), plus pivot tables, slicers, conditional formatting, and formula tracing. |
| `apps/slides` | **Captivela Slides** | `.pptx` presentations. In-house `.pptx` parse/render/edit engine with masters, charts, cropping, ink, and text shaping (HarfBuzz metrics).                                                                                                                                                                                                                    |
| `apps/pdf`    | **Captivela PDF**    | `.pdf` viewer/editor on pdf.js + pdf-lib: annotations, forms, outlines, stamps, signatures, page operations, and printing support.                                                                                                                                                                                                                            |
| `apps/shell`  | **Captivela Office** | The suite shell: home screen and tabbed hosting of the four editors. Public auto-update is disabled unless a release update URL is explicitly configured.                                                                                                                                                                                                     |

Every app embeds the same AI panel: block-granular AI editing with version
snapshots and diffs in docs, a tool-calling agent over workbook/slide/PDF
state in the others.

**AI providers.** The apps support user-configured OpenAI-compatible providers.
API keys are encrypted through Electron `safeStorage` and resolved by the
trusted main process; renderer processes receive only a stored-key marker.

## Engine packages

All pure TypeScript, no Electron dependency, unit-tested (except the UI kit):

- `packages/docx-engine` — docx parsing → block tree (with `docxIndex`
  anchors and passthrough), OOXML fragment generation, byte-level paragraph
  patching.
- `packages/pptx-engine` / `packages/pptx-render` — pptx model and rendering.
- `packages/file-parse` — text extraction for AI attachments (office formats,
  text formats).
- `packages/agent-core` — the AI agent loop and skill composition shared by
  every app.
- `packages/ai-provider` — provider abstraction and streaming for the model
  backends.
- `packages/ai-search` — Genspark auth + web/image search tools.
- `packages/i18n`, `packages/ui`, `packages/project-store`,
  `packages/electron-utils` — shared i18n core, React UI kit, recent-files
  store, and Electron main-process helpers.

## Development

Prerequisites:

- Node.js 20 and npm 10 or newer
- Rust stable (`cargo` on `PATH`) for the Sheets XLSX sidecar
- Xcode Command Line Tools for macOS packaging
- Windows/MSVC runner for an authoritative Windows x64 installer build

```bash
npm install
npm run fixtures     # generate test .docx fixtures
npm test             # engine + app unit tests (docs/sheets/slides need no display)
npm run typecheck    # tsc --noEmit across every workspace
npm run dev          # all four editors + shell against Vite dev servers
npm run dev:docs     # a single app (same pattern works per workspace)
npm run dist:mac     # package macOS dmg (regenerates third-party notices)
npm run dist:win     # package Windows nsis installer
```

The sheets app additionally needs a Rust toolchain for its xlsx sidecar
(`cargo` on PATH); `npm run build -w @genoffice/sheets` compiles it
automatically.

For deterministic CI installation use `npm ci`. The Windows release workflow
is [`.github/workflows/windows-build.yml`](.github/workflows/windows-build.yml).
Unsigned runs are contributor/developer-preview builds; signed runs fail closed
unless the required signing credentials are configured.

Local UI/e2e driver scripts (Playwright + Electron, for local acceptance, not
committed by default) live in [`scripts/drivers/`](scripts/drivers/README.md).

## Architecture notes (docx round trip)

```
open docx ─► archive original by hash (never touched)
          ─► docx-engine parses word/document.xml top-level elements (w:p / w:tbl / …)
          ─► Block tree, each block anchored by docxIndex + original XML slice
          ─► Tiptap streaming editor (manual + AI editing, dirty tracking)
save      ─► dirty blocks → OOXML fragments (referencing existing styles only)
          ─► splice into original document.xml (untouched blocks keep original bytes)
          ─► repack zip; all other entries copied byte-for-byte
```

The same philosophy holds in sheets and slides: the original file is the
source of truth, edits are applied as narrow patches, and everything the
editor didn't touch survives the round trip untouched.

## Security

See [SECURITY.md](SECURITY.md) for the process security posture (renderer
sandboxing, IPC validation, external-link gating) and the threat models for
AI-generated content.

## Third-party notices

`npm run notices` regenerates the bundled third-party license summary
(`tools/gen-third-party-notices.mjs`); all runtime dependencies are
MIT/Apache-2.0/OFL, and the bundled fonts (Liberation, Carlito, Caladea, Noto
CJK subsets) are OFL/Apache.

## License

Captivela Office is licensed under the [Apache License 2.0](LICENSE), with one
exception: the `ee/` directory is reserved for future enterprise modules and
is covered by the [GenOffice Enterprise License](ee/LICENSE).

The GenOffice and Genspark names and logos are trademarks of Mainfunc, Inc.
The Apache-2.0 license does not grant permission to use them (see section 6);
forks should use their own branding.
