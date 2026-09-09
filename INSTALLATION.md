# Installing Captivela Office Developer Preview

Captivela Office 0.5.0 is distributed as an unsigned developer preview. Download
only from the official GitHub prerelease:

<https://github.com/bryanperdana/captivela-office/releases/tag/v0.5.0>

Download `SHA256SUMS.txt` from the same release and verify the installer before
opening it. Do not use Actions artifacts or third-party mirrors as permanent
release sources.

## Windows x64

1. Download `Captivela.Office.Setup.0.5.0.exe` and `SHA256SUMS.txt`.
2. Verify the file in PowerShell:

   ```powershell
   Get-FileHash "$HOME\Downloads\Captivela.Office.Setup.0.5.0.exe" -Algorithm SHA256
   Get-Content "$HOME\Downloads\SHA256SUMS.txt"
   ```

3. Compare the full 64-character value with the matching filename in
   `SHA256SUMS.txt`. Do not continue if it differs.
4. Because the preview is unsigned, Windows SmartScreen may show **Windows
   protected your PC** and **Unknown publisher**. Only for a matching official
   artifact, select **More info**, then **Run anyway**.

Do not disable SmartScreen or Windows Defender globally.

## macOS Apple Silicon

This build requires an Apple Silicon Mac (`arm64`). Download
`Captivela.Office-0.5.0-arm64.dmg` and `SHA256SUMS.txt` from the same release.

### 1. Verify the DMG container and checksum

```bash
cd "$HOME/Downloads"
hdiutil verify "Captivela.Office-0.5.0-arm64.dmg"
shasum -a 256 "Captivela.Office-0.5.0-arm64.dmg"
grep 'Captivela.Office-0.5.0-arm64.dmg' SHA256SUMS.txt
```

`hdiutil verify` must succeed and both SHA-256 values must match exactly. If
either check fails, delete the DMG and download it again. A valid DMG proves
container integrity; it does not prove Apple platform trust.

### 2. Install and use macOS's normal override

Open the DMG, drag `Captivela Office.app` into `/Applications`, eject the DMG,
then Control-click the installed app and choose **Open**. Confirm **Open** again
when macOS shows the unidentified-developer warning.

### 3. If Gatekeeper still blocks the verified preview

First inspect the assessment instead of globally weakening security:

```bash
spctl --assess --type execute --verbose=2 "/Applications/Captivela Office.app"
xattr -l "/Applications/Captivela Office.app"
```

Only after the checksum matches the official release, remove quarantine from
this specific application and launch it:

```bash
xattr -dr com.apple.quarantine "/Applications/Captivela Office.app"
open "/Applications/Captivela Office.app"
```

Do not run `sudo spctl --master-disable`. Do not apply an ad-hoc signature to the
published app: doing so changes its bytes and makes future verification and
support ambiguous. If the narrowly scoped override fails, report the macOS
version, Mac model, checksum, and exact Gatekeeper message in a GitHub issue.

## What these checks prove

- Matching SHA-256 values prove that downloaded bytes match the release
  manifest.
- `hdiutil verify` proves DMG container integrity, not source provenance or
  Apple trust.
- The release workflow ties both platform builds to one exact source commit.
- This preview is still unsigned. The stable-release target is Developer ID and
  Authenticode signing, notarization/stapling, Gatekeeper assessment, and
  clean-machine acceptance.
