# Installing Captivela Office Developer Preview

Captivela Office 0.5.0 is currently distributed as an unsigned developer
preview. Use only artifacts downloaded from the official GitHub Release and
compare their SHA-256 values with [RELEASES.md](RELEASES.md).

## Windows x64

1. Download `Captivela Office Setup 0.5.0.exe` from the official release.
2. Verify it in PowerShell:

   ```powershell
   Get-FileHash "$HOME\Downloads\Captivela Office Setup 0.5.0.exe" -Algorithm SHA256
   ```

3. Compare the result with the checksum in `RELEASES.md`. Do not continue if it
   differs.
4. Because the preview is unsigned, Windows SmartScreen may show **Windows
   protected your PC** and **Unknown publisher**. For a matching official
   artifact, select **More info**, then **Run anyway**.

Do not disable SmartScreen or Windows Defender globally.

## macOS Apple Silicon

macOS can say that an unsigned or unnotarized app "is damaged and can't be
opened." This can mean either a genuinely corrupt download or a Gatekeeper/code
signature rejection. Prove the download first; do not immediately clear
quarantine.

### 1. Verify the DMG container and checksum

Replace the filename below with the exact downloaded release filename:

```bash
hdiutil verify "$HOME/Downloads/Captivela Office-0.5.0-arm64.dmg"
shasum -a 256 "$HOME/Downloads/Captivela Office-0.5.0-arm64.dmg"
```

`hdiutil verify` must report a valid checksum, and the SHA-256 value must match
the official release. If either check fails, delete the DMG and download it
again. Do not bypass macOS security for a mismatched artifact.

### 2. Install and use macOS's normal override

Open the DMG, drag `Captivela Office.app` into `/Applications`, eject the DMG,
then Control-click the app and choose **Open**. The standard **Open** confirmation
may be enough for an unidentified-developer warning.

### 3. If a verified app is still reported as damaged

Only after provenance and checksum verification, remove quarantine from this
specific application and launch it:

```bash
xattr -dr com.apple.quarantine "/Applications/Captivela Office.app"
open "/Applications/Captivela Office.app"
```

If the preview still fails because its local bundle signature is malformed,
apply an ad-hoc signature to this installed copy, verify it, and launch:

```bash
codesign --force --deep --sign - "/Applications/Captivela Office.app"
codesign --verify --deep --strict --verbose=2 "/Applications/Captivela Office.app"
open "/Applications/Captivela Office.app"
```

Use `sudo` only if macOS reports that permissions prevent modification. Never
run `sudo spctl --master-disable`; disabling Gatekeeper globally is not an
acceptable installation workaround.

## What these checks prove

- A matching SHA-256 value proves that the downloaded bytes match the artifact
  published by the project.
- `hdiutil verify` proves DMG container integrity, not application trust.
- Clearing quarantine or applying an ad-hoc signature is a narrow internal-test
  workaround, not a substitute for Developer ID signing and notarization.

The production fix is to sign nested code and the main app with Developer ID,
notarize and staple the app/DMG, verify Gatekeeper assessment on a freshly
downloaded copy, and run clean-user-machine acceptance testing.
