# Release Evidence

## Captivela Office 0.5.0 Developer Preview

Status: unsigned internal/developer-preview build. Do not present this artifact
as a trusted consumer release.

### Windows x64

- Artifact: `Captivela Office Setup 0.5.0.exe`
- Size: `121829830` bytes
- SHA-256: `1ae8dc3ec8acf9a902243b260fe1efeabb8e8d097a190a12b5cb6f99fa06f228`
- Source commit: `c3bc5946aa072c5e76c1867b36cdc09c29eb7e07`
- Native QA: package/runtime/editor/sidecar/NSIS lifecycle passed on GitHub's
  `windows-latest` runner
- Authenticode: not present; intentionally skipped for this internal build

The QA workflow validates the AMD64 sidecar, packaged Docs/Sheets/Slides/PDF
runtimes, synthetic DPAPI-backed key persistence, renderer plaintext absence,
a loopback-mocked Images API request, renderer console/page errors, silent NSIS
install, installed launch, uninstall, and executable removal.

### macOS Apple Silicon

No public 0.5.0 DMG checksum is recorded yet. Do not publish a DMG or instruct
users to bypass Gatekeeper until a specific artifact has been freshly verified
and its filename, size, SHA-256 value, architecture, package contents, runtime,
and unsigned/signing state are recorded here.

### Remaining public-release gates

1. Authenticode signing and timestamp verification for Windows.
2. Developer ID signing, notarization, stapling, and Gatekeeper assessment for
   macOS.
3. Fresh clean-user-machine acceptance after signing.
4. Publisher trust/SmartScreen evaluation.
5. Minor narrow-viewport toolbar polish for Slides and PDF.
