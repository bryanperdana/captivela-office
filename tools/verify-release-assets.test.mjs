import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import builderConfig from '../apps/shell/electron-builder.cjs'
import {
  expectedReleaseAssets,
  parseChecksumManifest,
  verifyReleaseAssets,
} from './verify-release-assets.mjs'

function fixture(platform = 'all') {
  const directory = mkdtempSync(join(tmpdir(), 'captivela-release-assets-'))
  for (const name of expectedReleaseAssets('0.5.0', platform)) {
    const size = name.endsWith('.blockmap') ? 32 : 10 * 1024 * 1024
    writeFileSync(join(directory, name), Buffer.alloc(size, name.length))
  }
  return directory
}

test('Electron Builder pins deterministic public macOS artifact names', () => {
  assert.equal(builderConfig.mac.artifactName, 'Captivela Office-${version}-${arch}.${ext}')
})

test('macOS workflow uses lipo input-file-first verification syntax', () => {
  const workflow = readFileSync(
    join(import.meta.dirname, '../.github/workflows/macos-build.yml'),
    'utf8',
  )
  assert.match(workflow, /lipo "\$app\/Contents\/MacOS\/Captivela Office" -verify_arch arm64/)
  assert.doesNotMatch(workflow, /lipo -verify_arch arm64/)
})

test('writes a basename-only manifest and verifies all v0.5.0 assets', async () => {
  const directory = fixture()
  const result = await verifyReleaseAssets({
    directory,
    version: '0.5.0',
    writeManifest: true,
  })
  assert.equal(result.assets.length, 5)
  const manifest = readFileSync(join(directory, 'SHA256SUMS'), 'utf8')
  assert.doesNotMatch(manifest, /captivela-release-assets-/)
  assert.equal(parseChecksumManifest(manifest).size, 5)
})

test('supports platform-specific build artifact verification', async () => {
  const directory = fixture('windows')
  const result = await verifyReleaseAssets({
    directory,
    version: '0.5.0',
    platform: 'windows',
    writeManifest: true,
  })
  assert.deepEqual(result.assets, expectedReleaseAssets('0.5.0', 'windows'))
})

test('rejects missing and undersized installers', async () => {
  const directory = fixture('macos')
  writeFileSync(join(directory, 'Captivela Office-0.5.0-arm64.dmg'), 'tiny')
  await assert.rejects(
    verifyReleaseAssets({
      directory,
      version: '0.5.0',
      platform: 'macos',
      writeManifest: true,
    }),
    /too small/,
  )
})

test('rejects paths, duplicate entries, and malformed manifest lines', () => {
  assert.throws(
    () => parseChecksumManifest(`${'a'.repeat(64)} */tmp/Captivela.dmg\n`),
    /must be a basename/,
  )
  assert.throws(
    () =>
      parseChecksumManifest(`${'a'.repeat(64)} *Captivela.dmg\n${'b'.repeat(64)} *Captivela.dmg\n`),
    /duplicate manifest entry/,
  )
  assert.throws(() => parseChecksumManifest('not-a-checksum\n'), /invalid SHA256SUMS line/)
})

test('rejects duplicate filename extensions before publishing', async () => {
  const directory = fixture('windows')
  writeFileSync(join(directory, 'Captivela Office Setup 0.5.0.exe.exe'), 'duplicate')
  await assert.rejects(
    verifyReleaseAssets({
      directory,
      version: '0.5.0',
      platform: 'windows',
      writeManifest: true,
    }),
    /duplicate extension/,
  )
})

test('detects modified assets after manifest creation', async () => {
  const directory = fixture('windows')
  await verifyReleaseAssets({
    directory,
    version: '0.5.0',
    platform: 'windows',
    writeManifest: true,
  })
  writeFileSync(join(directory, 'Captivela Office Setup 0.5.0.exe.blockmap'), Buffer.alloc(32, 7))
  await assert.rejects(
    verifyReleaseAssets({ directory, version: '0.5.0', platform: 'windows' }),
    /checksum mismatch/,
  )
})
