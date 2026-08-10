param(
  [string]$ReleaseDir = "apps/shell/release",
  [string]$OutputDir = "artifacts/windows-qa"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$appDir = Join-Path $ReleaseDir "win-unpacked"
$appExe = Join-Path $appDir "Captivela Office.exe"
$resources = Join-Path $appDir "resources"
$sidecar = Join-Path $resources "native/xlsx-sidecar.exe"
$required = @(
  $appExe,
  $sidecar,
  (Join-Path $resources "modules/docs/renderer/index.html"),
  (Join-Path $resources "modules/sheets/renderer/index.html"),
  (Join-Path $resources "modules/slides/renderer/index.html"),
  (Join-Path $resources "modules/pdf/renderer/index.html"),
  (Join-Path $resources "THIRD-PARTY-NOTICES.txt")
)
foreach ($path in $required) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Packaged Windows input missing: $path"
  }
}

$probeLine = '{"version":1,"requestId":"windows-qa-probe","command":"archive_manifest","path":"Z:\\captivela-qa-missing.xlsx"}'
$probeOutput = $probeLine | & $sidecar 2>&1
if ($LASTEXITCODE -ne 0) { throw "XLSX sidecar protocol probe exited $LASTEXITCODE: $probeOutput" }
try { $probe = ($probeOutput | Select-Object -First 1) | ConvertFrom-Json } catch {
  throw "XLSX sidecar did not return JSON: $probeOutput"
}
if ($probe.requestId -ne "windows-qa-probe" -or $probe.version -ne 1) {
  throw "XLSX sidecar returned an invalid protocol envelope: $probeOutput"
}

$userData = Join-Path $env:RUNNER_TEMP "captivela-office-windows-qa"
if (Test-Path $userData) { Remove-Item -Recurse -Force $userData }
$qaPdf = Join-Path $env:RUNNER_TEMP "captivela-office-windows-qa.pdf"
node tools/create-qa-pdf.cjs $qaPdf
if ($LASTEXITCODE -ne 0) { throw "Could not create Windows QA PDF" }
$syntheticKey = "captivela-windows-qa-secret-$([guid]::NewGuid().ToString('N'))"
$env:CAPTIVELA_QA_SYNTHETIC_KEY = $syntheticKey
$env:CAPTIVELA_QA_IMAGES_BASE_URL = "http://127.0.0.1:18765/v1"
$mockProcess = Start-Process -FilePath "node" -ArgumentList "tools/mock-images-api.cjs" -PassThru
$mockDeadline = (Get-Date).AddSeconds(15)
$mockReady = $false
while ((Get-Date) -lt $mockDeadline) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $client.Connect('127.0.0.1', 18765)
    $mockReady = $true
    break
  } catch { Start-Sleep -Milliseconds 250 } finally { $client.Dispose() }
}
if (-not $mockReady) {
  if ($mockProcess -and -not $mockProcess.HasExited) { Stop-Process -Id $mockProcess.Id -Force }
  throw "Local Images API mock did not start within 15 seconds"
}
$process = Start-Process -FilePath $appExe -ArgumentList @(
  "--user-data-dir=$userData",
  "--remote-debugging-port=9333"
) -PassThru

try {
  $deadline = (Get-Date).AddSeconds(30)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    try {
      $version = Invoke-RestMethod -Uri "http://127.0.0.1:9333/json/version" -TimeoutSec 2
      if ($version.Browser -match "Chrome") { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $ready) { throw "Packaged Captivela Office did not expose CDP within 30 seconds" }

  $env:CAPTIVELA_CDP = "http://127.0.0.1:9333"
  $env:CAPTIVELA_QA_OUTPUT = (Resolve-Path $OutputDir).Path
  $env:CAPTIVELA_QA_PDF = $qaPdf
  node tools/qa-packaged-captivela.mjs | Tee-Object -FilePath (Join-Path $OutputDir "runtime.json")
  if ($LASTEXITCODE -ne 0) { throw "Packaged Playwright QA failed" }
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }
  if ($mockProcess -and -not $mockProcess.HasExited) { Stop-Process -Id $mockProcess.Id -Force }
}

$settingsFiles = @(
  (Join-Path $userData "ai-settings.json"),
  (Join-Path $userData "ai-secrets.json")
)
foreach ($file in $settingsFiles) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Expected AI settings file missing: $file" }
  $raw = [System.IO.File]::ReadAllBytes($file)
  $text = [System.Text.Encoding]::UTF8.GetString($raw)
  if ($text.Contains($syntheticKey)) { throw "Synthetic API key leaked as plaintext in $file" }
}

$installer = Get-ChildItem -Path $ReleaseDir -Filter "Captivela Office Setup *.exe" -File |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { throw "Captivela NSIS installer was not produced" }

$installDir = Join-Path $env:RUNNER_TEMP "captivela-office-installed"
if (Test-Path $installDir) { Remove-Item -Recurse -Force $installDir }
$installProcess = Start-Process -FilePath $installer.FullName -ArgumentList @('/S', "/D=$installDir") -Wait -PassThru
if ($installProcess.ExitCode -ne 0) { throw "NSIS installer exited $($installProcess.ExitCode)" }
$installedExe = Join-Path $installDir "Captivela Office.exe"
if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
  throw "Installed Captivela Office executable missing: $installedExe"
}
$installedUserData = Join-Path $env:RUNNER_TEMP "captivela-office-installed-qa"
$installedProcess = Start-Process -FilePath $installedExe -ArgumentList @(
  "--user-data-dir=$installedUserData",
  "--remote-debugging-port=9334"
) -PassThru
try {
  $deadline = (Get-Date).AddSeconds(30)
  $installedReady = $false
  while ((Get-Date) -lt $deadline) {
    try {
      $version = Invoke-RestMethod -Uri "http://127.0.0.1:9334/json/version" -TimeoutSec 2
      if ($version.Browser -match "Chrome") { $installedReady = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $installedReady) { throw "Installed Captivela Office did not launch within 30 seconds" }
} finally {
  if ($installedProcess -and -not $installedProcess.HasExited) {
    Stop-Process -Id $installedProcess.Id -Force
  }
}
$uninstaller = Get-ChildItem -Path $installDir -Filter "Uninstall*.exe" -File | Select-Object -First 1
if (-not $uninstaller) { throw "NSIS uninstaller was not installed" }
$uninstallProcess = Start-Process -FilePath $uninstaller.FullName -ArgumentList '/S' -Wait -PassThru
if ($uninstallProcess.ExitCode -ne 0) { throw "NSIS uninstaller exited $($uninstallProcess.ExitCode)" }
if (Test-Path -LiteralPath $installedExe) { throw "NSIS uninstall left the application executable behind" }

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer.FullName).Hash.ToLowerInvariant()
$report = [ordered]@{
  schema = "captivela-windows-qa-v1"
  app = $appExe
  installer = $installer.FullName
  installerSha256 = $hash
  sidecarProtocol = 1
  sidecarProbeErrorCode = $probe.error.code
  modules = @("docs", "sheets", "slides", "pdf")
  runtimeCdp = $true
  installerLifecycle = $true
}
$report | ConvertTo-Json -Depth 4 | Set-Content -Encoding UTF8 (Join-Path $OutputDir "package-report.json")
$report | ConvertTo-Json -Depth 4
