# Release Evidence

## Captivela Office 0.5.0 Developer Preview

Status: unsigned developer preview. This is not a signed or notarized consumer
release. Permanent downloads will be attached to the GitHub prerelease together
with `SHA256SUMS.txt`; Actions artifacts are QA evidence only.

### Published exact-commit release evidence

- Source/tag commit: `cf0f31e7b894a9bf38826e2083df26db86017065`
- Release workflow: [run 31730060778](https://github.com/bryanperdana/captivela-office/actions/runs/31730060778)
- Windows installer: `Captivela.Office.Setup.0.5.0.exe`, `121221505` bytes,
  SHA-256 `5480a65758fdf71ffaadb4e933a42264bd554a5b142210e2df2e8cc57b5e0056`
- macOS Apple Silicon DMG: `Captivela.Office-0.5.0-arm64.dmg`, `145069701`
  bytes, SHA-256 `9ccb2adf809cb35a8fb8fd454fac880735968f35af0bc393cf1e3e86694b7480`
- macOS Apple Silicon ZIP: `Captivela.Office-0.5.0-arm64.zip`, `145348173`
  bytes, SHA-256 `80fae2b1aef4c669c5aee8b1d7af023d97d1c0b4f5c4fad8d9df31c0577b2703`
- Independent post-publish redownload: all five distributable files pass
  `shasum -a 256 -c SHA256SUMS.txt`; the DMG also passes `hdiutil verify`.
- Native QA: package/runtime/editor/sidecar/NSIS lifecycle passed on GitHub's
  `windows-latest` runner
- Authenticode: not present; unsigned-preview warning required

The QA workflow validates the AMD64 sidecar, packaged Docs/Sheets/Slides/PDF
runtimes, synthetic DPAPI-backed key persistence, renderer plaintext absence,
a loopback-mocked Images API request, renderer console/page errors, silent NSIS
install, installed launch, uninstall, and executable removal.

The attached `SHA256SUMS.txt` is the authoritative byte-level record.

### macOS Apple Silicon release gate

The previous internal DMG is deliberately excluded: its container was valid and
its app launched, but its build predates `ec69094` and no source attestation binds
it to the release source.

The public prerelease workflow must rebuild on GitHub's standard `macos-14`
M1/arm64 runner from the same exact commit as Windows and must verify:

- DMG container integrity with `hdiutil verify`
- bundle identifier and version
- arm64 main executable and XLSX sidecar
- packaged Docs, Sheets, Slides, PDF, and license resources
- isolated launch smoke
- exact final filename, size, and SHA-256
- explicit unsigned/not-notarized status

The published macOS artifacts were built and verified on GitHub's standard
`macos-14` M1/arm64 runner from the exact tagged source above.

### Release automation guarantees

`.github/workflows/release.yml` resolves one immutable source commit, calls the
reusable Windows and macOS workflows for that same commit, validates all five
platform assets, regenerates a basename-only checksum manifest, creates a draft
prerelease, and compares every remote asset's exact public filename, size, and
GitHub SHA-256 digest before publication. Missing platforms, wrong versions,
wrong commits, malformed filenames, or checksum mismatches fail closed.

### Known preview limitations

1. Windows binaries are not Authenticode-signed and may trigger SmartScreen.
2. macOS binaries are not Developer ID-signed or notarized and may trigger
   Gatekeeper.
3. Fresh clean-user-machine acceptance after signing remains a future stable
   release gate.
4. Publisher trust/SmartScreen reputation has not been established.
5. Minor narrow-viewport toolbar polish remains for Slides and PDF.
