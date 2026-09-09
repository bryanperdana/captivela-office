const assert = require('node:assert/strict')
const { chmodSync, mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { test } = require('node:test')
const {
  ELF_MACHINE_X86_64,
  readElfMachine,
  verifyLinuxPackageInputs,
} = require('./linux-package-inputs.cjs')

function writeElf(path, machine = ELF_MACHINE_X86_64) {
  const bytes = Buffer.alloc(64)
  bytes.write('\x7fELF', 0, 'binary')
  bytes[4] = 2 // ELFCLASS64
  bytes[5] = 1 // ELFDATA2LSB
  bytes.writeUInt16LE(machine, 18)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, bytes)
  chmodSync(path, 0o755)
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'captivela-linux-inputs-'))
  for (const module of ['docs', 'sheets', 'slides', 'pdf'])
    mkdirSync(join(root, 'apps', module, 'out'), { recursive: true })
  mkdirSync(join(root, 'apps', 'shell', 'build'), { recursive: true })
  writeFileSync(join(root, 'apps', 'shell', 'build', 'THIRD-PARTY-NOTICES.txt'), 'notices')
  writeFileSync(join(root, 'apps', 'shell', 'build', 'icon.png'), 'png')
  const sidecar = join(root, 'apps/sheets/native/xlsx-engine/target/release/xlsx-sidecar')
  writeElf(sidecar)
  return { root, sidecar }
}

test('accepts complete Linux x64 AppImage package inputs', () => {
  const { root, sidecar } = fixture()
  assert.equal(readElfMachine(sidecar), ELF_MACHINE_X86_64)
  assert.deepEqual(verifyLinuxPackageInputs({ root }).machine, 'x86_64')
})

test('fails closed when the Linux sidecar is missing', () => {
  const { root } = fixture()
  const missingSidecarRoot = join(root, 'missing-sidecar-copy')
  for (const module of ['docs', 'sheets', 'slides', 'pdf'])
    mkdirSync(join(missingSidecarRoot, 'apps', module, 'out'), { recursive: true })
  mkdirSync(join(missingSidecarRoot, 'apps', 'shell', 'build'), { recursive: true })
  writeFileSync(
    join(missingSidecarRoot, 'apps', 'shell', 'build', 'THIRD-PARTY-NOTICES.txt'),
    'notices',
  )
  writeFileSync(join(missingSidecarRoot, 'apps', 'shell', 'build', 'icon.png'), 'png')
  assert.throws(
    () => verifyLinuxPackageInputs({ root: missingSidecarRoot }),
    /Linux x64 XLSX sidecar/,
  )
})

test('rejects a non-x86_64 Linux sidecar', () => {
  const { root, sidecar } = fixture()
  writeElf(sidecar, 0xb7)
  assert.throws(() => verifyLinuxPackageInputs({ root }), /wrong ELF machine/)
})

test('rejects a Linux sidecar without execute permission', () => {
  const { root, sidecar } = fixture()
  chmodSync(sidecar, 0o644)
  assert.throws(() => verifyLinuxPackageInputs({ root }), /not executable/)
})

test('Electron Builder uses the Captivela Linux AppImage x64 contract', () => {
  const config = require('../apps/shell/electron-builder.cjs')
  assert.equal(config.productName, 'Captivela Office')
  assert.equal(config.appId, 'com.captivela.office')
  assert.deepEqual(config.linux.target, ['AppImage'])
  assert.equal(config.linux.executableName, 'captivela-office')
  assert.equal(config.linux.syncDesktopName, true)
  assert.match(config.linux.artifactName, /Captivela-Office-\$\{version\}-\$\{arch\}\.\$\{ext\}/)
  assert.match(config.linux.extraResources[0].from, /target\/release\/xlsx-sidecar$/)
})

test('Linux release workflow uses Node 22 and validates package inputs', () => {
  const root = resolve(__dirname, '..')
  const workflow = require('node:fs').readFileSync(
    join(root, '.github/workflows/release-linux.yml'),
    'utf8',
  )
  assert.match(workflow, /node-version: 22/)
  assert.match(workflow, /npm run dist:linux/)
  assert.match(workflow, /CAPTIVELA_OFFICE_UPDATE_URL/)
  assert.match(workflow, /Verify packaged AppImage/)
})
