const assert = require('node:assert/strict')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { test } = require('node:test')
const {
  WINDOWS_AMD64_MACHINE,
  readPeMachine,
  verifyWindowsPackageInputs,
} = require('./windows-package-inputs.cjs')

function writePe(path, machine = WINDOWS_AMD64_MACHINE) {
  const bytes = Buffer.alloc(128)
  bytes.write('MZ', 0, 'ascii')
  bytes.writeUInt32LE(64, 0x3c)
  bytes.write('PE\0\0', 64, 'ascii')
  bytes.writeUInt16LE(machine, 68)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, bytes)
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'captivela-win-inputs-'))
  for (const module of ['docs', 'sheets', 'slides', 'pdf'])
    mkdirSync(join(root, 'apps', module, 'out'), { recursive: true })
  mkdirSync(join(root, 'apps', 'shell', 'build'), { recursive: true })
  writeFileSync(join(root, 'apps', 'shell', 'build', 'THIRD-PARTY-NOTICES.txt'), 'notices')
  writeFileSync(join(root, 'apps', 'shell', 'build', 'icon.ico'), 'ico')
  const sidecar = join(
    root,
    'apps/sheets/native/xlsx-engine/target/x86_64-pc-windows-msvc/release/xlsx-sidecar.exe',
  )
  writePe(sidecar)
  return { root, sidecar }
}

test('accepts complete Windows x64 package inputs', () => {
  const { root, sidecar } = fixture()
  assert.equal(readPeMachine(sidecar), WINDOWS_AMD64_MACHINE)
  assert.deepEqual(verifyWindowsPackageInputs({ root }).machine, 'x86_64')
})

test('fails closed when the Windows sidecar is missing', () => {
  const { root } = fixture()
  const wrongRoot = join(root, 'missing-sidecar-copy')
  for (const module of ['docs', 'sheets', 'slides', 'pdf'])
    mkdirSync(join(wrongRoot, 'apps', module, 'out'), { recursive: true })
  mkdirSync(join(wrongRoot, 'apps', 'shell', 'build'), { recursive: true })
  writeFileSync(join(wrongRoot, 'apps', 'shell', 'build', 'THIRD-PARTY-NOTICES.txt'), 'notices')
  writeFileSync(join(wrongRoot, 'apps', 'shell', 'build', 'icon.ico'), 'ico')
  assert.throws(() => verifyWindowsPackageInputs({ root: wrongRoot }), /XLSX sidecar/)
})

test('rejects a non-AMD64 sidecar', () => {
  const { root, sidecar } = fixture()
  writePe(sidecar, 0xaa64)
  assert.throws(() => verifyWindowsPackageInputs({ root }), /wrong PE machine/)
})

test('Electron Builder uses the Captivela MSVC x64 release contract', () => {
  const config = require('../apps/shell/electron-builder.cjs')
  assert.equal(config.productName, 'Captivela Office')
  assert.equal(config.appId, 'com.captivela.office')
  assert.equal(config.win.artifactName, 'Captivela Office Setup ${version}.${ext}')
  assert.equal(config.win.extraResources[0].from.includes('x86_64-pc-windows-msvc'), true)
  assert.equal(config.win.extraResources[0].from.includes('windows-gnu'), false)
  assert.equal(config.nsis.shortcutName, 'Captivela Office')
  assert.equal(config.nsis.uninstallDisplayName, 'Captivela Office')
})

test('Windows promotion uses Captivela-only artifact and alias names', () => {
  const root = resolve(__dirname, '..')
  const promotion = readFileSync(join(root, 'scripts/promote-stable.cjs'), 'utf8')
  const workflow = readFileSync(join(root, '.github/workflows/promote-stable.yml'), 'utf8')
  const combined = `${promotion}\n${workflow}`
  const legacySetup = ['Gen', 'Office', 'Setup'].join('')
  const legacyArchive = ['Gen', 'Office', '-win'].join('')
  assert.equal(combined.includes(legacySetup), false)
  assert.equal(combined.includes(legacyArchive), false)
  assert.match(combined, /Captivela Office Setup/)
  assert.match(combined, /CaptivelaOfficeSetup\.exe/)
})

test('packaged QA reads the canonical renderer stored-key marker', () => {
  const root = resolve(__dirname, '..')
  const harness = readFileSync(join(root, 'tools/qa-packaged-captivela.mjs'), 'utf8')
  assert.match(harness, /reread\.apiKeyPresent\?\.\[provider\]/)
  assert.doesNotMatch(harness, /providers\[provider\].*hasStoredApiKey/)
})
