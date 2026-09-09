const { spawnSync } = require('node:child_process')
const { existsSync, mkdtempSync, readFileSync, rmSync, statSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, join, resolve } = require('node:path')
const { readElfMachine, ELF_MACHINE_X86_64 } = require('./linux-package-inputs.cjs')

function fail(message) {
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
}

function assertFile(path, label) {
  if (!existsSync(path)) throw new Error(`Packaged AppImage is missing ${label}: ${path}`)
  const stat = statSync(path)
  if (!stat.isFile() || stat.size === 0)
    throw new Error(`Packaged AppImage has an empty or invalid ${label}: ${path}`)
  return stat
}

function assertExecutable(path, label) {
  const stat = assertFile(path, label)
  if ((stat.mode & 0o111) === 0)
    throw new Error(`Packaged AppImage ${label} is not executable: ${path}`)
}

function verifyExtractedAppImage(root) {
  const desktopPath = join(root, 'captivela-office.desktop')
  const desktop = readFileSync(desktopPath, 'utf8')
  assertExecutable(join(root, 'captivela-office'), 'Captivela Office executable')
  assertExecutable(join(root, 'resources', 'native', 'xlsx-sidecar'), 'XLSX sidecar')
  const sidecar = join(root, 'resources', 'native', 'xlsx-sidecar')
  if (readElfMachine(sidecar) !== ELF_MACHINE_X86_64)
    throw new Error('Packaged AppImage XLSX sidecar is not x86_64 ELF')

  for (const module of ['docs', 'sheets', 'slides', 'pdf']) {
    const moduleRoot = join(root, 'resources', 'modules', module)
    if (!existsSync(moduleRoot) || !statSync(moduleRoot).isDirectory())
      throw new Error(`Packaged AppImage is missing ${module} module resources: ${moduleRoot}`)
  }

  for (const expected of [
    // AppImage desktop files are launched through the bundle's AppRun entrypoint;
    // the real executable name is verified above.
    'Exec=AppRun',
    'StartupWMClass=captivela-office',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/pdf',
  ]) {
    if (!desktop.includes(expected))
      throw new Error(`Packaged desktop entry is missing ${JSON.stringify(expected)}`)
  }
}

function main(argv) {
  if (argv.length !== 1) throw new Error('expected exactly one AppImage path')
  const appImage = resolve(argv[0])
  if (!existsSync(appImage)) throw new Error(`AppImage is missing: ${appImage}`)
  assertExecutable(appImage, 'artifact')

  const extractionDir = mkdtempSync(join(tmpdir(), 'captivela-appimage-'))
  try {
    const result = spawnSync(appImage, ['--appimage-extract'], {
      cwd: extractionDir,
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
      throw new Error(`AppImage extraction failed (${result.status ?? result.signal}): ${output}`)
    }
    verifyExtractedAppImage(join(extractionDir, 'squashfs-root'))
    process.stdout.write(`${basename(appImage)}: packaged Linux AppImage verified\n`)
  } finally {
    rmSync(extractionDir, { force: true, recursive: true })
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}

module.exports = { verifyExtractedAppImage }
