const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { chmodSync, mkdirSync, mkdtempSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { test } = require('node:test')
const { ELF_MACHINE_X86_64 } = require('./linux-package-inputs.cjs')
const { verifyExtractedAppImage } = require('./verify-linux-appimage.cjs')

const script = resolve(__dirname, 'verify-linux-appimage.cjs')

function writeElf(path) {
  const bytes = Buffer.alloc(64)
  bytes.write('\x7fELF', 0, 'binary')
  bytes[4] = 2
  bytes[5] = 1
  bytes.writeUInt16LE(ELF_MACHINE_X86_64, 18)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, bytes)
  chmodSync(path, 0o755)
}

function extractedAppImageFixture(exec = 'AppRun') {
  const root = mkdtempSync(join(tmpdir(), 'captivela-appimage-root-'))
  writeElf(join(root, 'captivela-office'))
  writeElf(join(root, 'resources', 'native', 'xlsx-sidecar'))
  for (const module of ['docs', 'sheets', 'slides', 'pdf'])
    mkdirSync(join(root, 'resources', 'modules', module), { recursive: true })
  writeFileSync(
    join(root, 'captivela-office.desktop'),
    `[Desktop Entry]\nExec=${exec}\nStartupWMClass=captivela-office\nMimeType=application/vnd.openxmlformats-officedocument.wordprocessingml.document;application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;application/vnd.openxmlformats-officedocument.presentationml.presentation;application/pdf;\n`,
  )
  return root
}

test('accepts AppImage desktop launchers that delegate through AppRun', () => {
  assert.doesNotThrow(() => verifyExtractedAppImage(extractedAppImageFixture()))
})

test('rejects an extracted AppImage desktop launcher with an unexpected command', () => {
  assert.throws(
    () => verifyExtractedAppImage(extractedAppImageFixture('captivela-office')),
    /Exec=AppRun/,
  )
})

test('fails closed when no AppImage path is supplied', () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /expected exactly one AppImage path/)
})

test('fails closed when the AppImage does not exist', () => {
  const missing = join(
    mkdtempSync(join(tmpdir(), 'captivela-missing-appimage-')),
    'missing.AppImage',
  )
  const result = spawnSync(process.execPath, [script, missing], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /AppImage is missing/)
})
