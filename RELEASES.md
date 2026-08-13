# Release Evidence

## Captivela Office 0.5.0 Developer Preview

Status: unsigned developer preview. This is not a signed or notarized consumer
release. Permanent downloads will be attached to the GitHub prerelease together
with `SHA256SUMS.txt`; Actions artifacts are QA evidence only.

### Windows x64 verified baseline

- Artifact: `Captivela Office Setup 0.5.0.exe`
- Size: `120858382` bytes
- SHA-256: `8f5fb6905489a615e5f337687851def41daec4e287add545e8df520434b1f848`
- Source commit: `ec69094efc735158cb4adebbc668344098b67df7`
- CI: [Windows x64 build run 31616496480](https://github.com/bryanperdana/captivela-office/actions/runs/31616496480)
- Native QA: package/runtime/editor/sidecar/NSIS lifecycle passed on GitHub's
  `windows-latest` runner
- Authenticode: not present; unsigned-preview warning required

The QA workflow validates the AMD64 sidecar, packaged Docs/Sheets/Slides/PDF
runtimes, synthetic DPAPI-backed key persistence, renderer plaintext absence,
a loopback-mocked Images API request, renderer console/page errors, silent NSIS
install, installed launch, uninstall, and executable removal.

The public prerelease is rebuilt from the final tagged source. Its final size and
SHA-256 are authoritative only when they match the attached `SHA256SUMS.txt`.

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

No macOS checksum is claimed in source before that fresh build succeeds. The
published `SHA256SUMS.txt` is the final byte-level record.

### Release automation guarantees

`.github/workflows/release.yml` resolves one immutable source commit, calls the
reusable Windows and macOS workflows for that same commit, validates all five
platform assets, regenerates a basename-only checksum manifest, creates a draft
prerelease, verifies every uploaded asset is non-empty, and only then publishes
the prerelease. Missing platforms, wrong versions, wrong commits, malformed
filenames, or checksum mismatches fail closed.

### Known preview limitations

1. Windows binaries are not Authenticode-signed and may trigger SmartScreen.
2. macOS binaries are not Developer ID-signed or notarized and may trigger
   Gatekeeper.
3. Fresh clean-user-machine acceptance after signing remains a future stable
   release gate.
4. Publisher trust/SmartScreen reputation has not been established.
5. Minor narrow-viewport toolbar polish remains for Slides and PDF.
