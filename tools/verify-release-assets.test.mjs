import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import builderConfig from '../apps/shell/electron-builder.cjs'
import {
  expectedReleaseAssets,
  parseChecksumManifest,
  publicReleaseAssetName,
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

test('maps internal filenames to GitHub canonical public names', () => {
  assert.deepEqual(expectedReleaseAssets('0.5.1').map(publicReleaseAssetName), [
    'Captivela.Office.Setup.0.5.1.exe',
    'Captivela.Office.Setup.0.5.1.exe.blockmap',
    'Captivela.Office-0.5.1-arm64.dmg',
    'Captivela.Office-0.5.1-arm64.dmg.blockmap',
    'Captivela.Office-0.5.1-arm64.zip',
    'Captivela-Office-0.5.1-x64.AppImage',
  ])
})

test('includes one deterministic Linux AppImage in the release contract', async () => {
  assert.deepEqual(expectedReleaseAssets('0.5.1', 'linux'), ['Captivela-Office-0.5.1-x64.AppImage'])

  const directory = fixture('linux')
  const result = await verifyReleaseAssets({
    directory,
    version: '0.5.0',
    platform: 'linux',
    writeManifest: true,
  })
  assert.deepEqual(result.assets, ['Captivela-Office-0.5.0-x64.AppImage'])
  assert.equal(parseChecksumManifest(readFileSync(join(directory, 'SHA256SUMS'), 'utf8')).size, 1)
})

test('macOS workflow uses lipo input-file-first verification syntax', () => {
  const workflow = readFileSync(
    join(import.meta.dirname, '../.github/workflows/macos-build.yml'),
    'utf8',
  )
  assert.match(workflow, /lipo "\$app\/Contents\/MacOS\/Captivela Office" -verify_arch arm64/)
  assert.doesNotMatch(workflow, /lipo -verify_arch arm64/)
})

test('release workflow verifies the draft target before the published tag ref', () => {
  const workflow = readFileSync(
    join(import.meta.dirname, '../.github/workflows/release.yml'),
    'utf8',
  )
  const draftCheck = workflow.indexOf('draft_target=$(gh api')
  const publish = workflow.indexOf(
    'gh release edit "$TAG" --repo "$GITHUB_REPOSITORY" --draft=false',
  )
  const tagCheck = workflow.indexOf('tag_commit=$(gh api')
  assert.ok(draftCheck >= 0 && publish > draftCheck && tagCheck > publish)
  assert.match(workflow, /release_id=\$\(gh release view "\$TAG"[^\n]+--json id --jq '\.id'\)/)
  assert.match(workflow, /releases\/\$release_id/)
  assert.match(workflow, /gh release edit "\$TAG"[^\n]+--target "\$RELEASE_COMMIT"/)
  assert.doesNotMatch(workflow, /--paginate "repos\/\$GITHUB_REPOSITORY\/releases\?per_page=100"/)
  assert.doesNotMatch(workflow, /releases\/tags\/\$TAG.*\.draft/)
})

test('unified prerelease builds and downloads a verified Linux AppImage from the resolved commit', () => {
  const workflow = readFileSync(
    join(import.meta.dirname, '../.github/workflows/release.yml'),
    'utf8',
  )
  assert.match(workflow, /linux:\n {4}needs: resolve/)
  assert.match(workflow, /uses: \.\/\.github\/workflows\/linux-build\.yml/)
  assert.match(workflow, /needs: \[resolve, windows, macos, linux\]/)
  assert.match(workflow, /captivela-office-linux-x64-\$\{\{ env\.ARTIFACT_KEY \}\}/)
  assert.match(workflow, /incoming\/linux\/Captivela-Office-\$\{VERSION\}-x64\.AppImage/)
})

test('Linux reusable build verifies resolved source and stages a deterministic AppImage asset', () => {
  const workflow = readFileSync(
    join(import.meta.dirname, '../.github/workflows/linux-build.yml'),
    'utf8',
  )
  assert.match(workflow, /workflow_call:/)
  assert.match(workflow, /expected_commit:/)
  assert.match(workflow, /EXPECTED_VERSION:/)
  assert.match(workflow, /node-version: 22/)
  assert.match(workflow, /npm run dist:linux/)
  assert.match(workflow, /npm run verify:linux:appimage/)
  assert.match(workflow, /Captivela-Office-\$\{version\}-x64\.AppImage/)
  assert.match(
    workflow,
    /captivela-office-linux-x64-\$\{\{ inputs\.artifact_key \|\| github\.sha \}\}/,
  )
})

test('Linux download documentation targets the immutable v0.5.1 prerelease asset', () => {
  const readme = readFileSync(join(import.meta.dirname, '../README.md'), 'utf8')
  const installation = readFileSync(join(import.meta.dirname, '../INSTALLATION.md'), 'utf8')
  const asset = 'Captivela-Office-0.5.1-x64.AppImage'
  const releaseUrl = `https://github.com/bryanperdana/captivela-office/releases/download/v0.5.1/${asset}`

  assert.match(readme, new RegExp(releaseUrl.replaceAll('.', '\\.')))
  assert.match(readme, /Linux x86_64/)
  assert.match(installation, new RegExp(asset.replaceAll('.', '\\.')))
  assert.match(installation, /chmod \+x/)
  assert.match(installation, /manual upgrades/)
  assert.doesNotMatch(readme, /actions\/runs\/.*AppImage/)
})

test('writes a basename-only manifest and verifies all six platform assets', async () => {
  const directory = fixture()
  const result = await verifyReleaseAssets({
    directory,
    version: '0.5.0',
    writeManifest: true,
  })
  assert.equal(result.assets.length, 6)
  const manifest = readFileSync(join(directory, 'SHA256SUMS'), 'utf8')
  assert.doesNotMatch(manifest, /captivela-release-assets-/)
  assert.equal(parseChecksumManifest(manifest).size, 6)
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
