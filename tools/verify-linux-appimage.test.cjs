const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { test } = require('node:test')

const script = resolve(__dirname, 'verify-linux-appimage.cjs')

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
