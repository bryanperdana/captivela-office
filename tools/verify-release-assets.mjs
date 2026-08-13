#!/usr/bin/env node

import { createHash } from 'node:crypto'
import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const INSTALLER_MIN_BYTES = 10 * 1024 * 1024
const BLOCKMAP_MIN_BYTES = 16
const HASH_LINE = /^([a-fA-F0-9]{64}) [ *](.+)$/

export function expectedReleaseAssets(version, platform = 'all') {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`invalid version: ${version}`)
  const assets = {
    windows: [
      `Captivela Office Setup ${version}.exe`,
      `Captivela Office Setup ${version}.exe.blockmap`,
    ],
    macos: [
      `Captivela Office-${version}-arm64.dmg`,
      `Captivela Office-${version}-arm64.dmg.blockmap`,
      `Captivela Office-${version}-arm64.zip`,
    ],
  }
  if (platform === 'all') return [...assets.windows, ...assets.macos]
  if (!assets[platform]) throw new Error(`invalid platform: ${platform}`)
  return assets[platform]
}

function hasDuplicateExtension(name) {
  const suffixes = name.toLowerCase().split('.').slice(1)
  return suffixes.some((suffix, index) => index > 0 && suffix === suffixes[index - 1])
}

export function parseChecksumManifest(text) {
  const entries = new Map()
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    if (!rawLine) continue
    const match = HASH_LINE.exec(rawLine)
    if (!match) throw new Error(`invalid SHA256SUMS line ${index + 1}`)
    const [, hash, name] = match
    if (isAbsolute(name) || basename(name) !== name || name.includes('/') || name.includes('\\')) {
      throw new Error(`manifest entry must be a basename: ${name}`)
    }
    if (entries.has(name)) throw new Error(`duplicate manifest entry: ${name}`)
    entries.set(name, hash.toLowerCase())
  }
  return entries
}

export async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

export async function verifyReleaseAssets({
  directory,
  version,
  platform = 'all',
  manifest = join(directory, 'SHA256SUMS'),
  writeManifest = false,
}) {
  const root = resolve(directory)
  const expected = expectedReleaseAssets(version, platform)
  const names = readdirSync(root).filter((name) => statSync(join(root, name)).isFile())

  for (const name of names) {
    if (hasDuplicateExtension(name)) throw new Error(`duplicate extension in filename: ${name}`)
  }

  for (const name of expected) {
    const path = join(root, name)
    if (!existsSync(path)) throw new Error(`missing release asset: ${name}`)
    const minimum = name.endsWith('.blockmap') ? BLOCKMAP_MIN_BYTES : INSTALLER_MIN_BYTES
    const size = statSync(path).size
    if (size < minimum) throw new Error(`release asset is too small (${size} bytes): ${name}`)
  }

  const hashes = new Map()
  for (const name of expected) hashes.set(name, await sha256File(join(root, name)))

  if (writeManifest) {
    const content = expected.map((name) => `${hashes.get(name)} *${name}`).join('\n') + '\n'
    writeFileSync(manifest, content, 'utf8')
  }
  if (!existsSync(manifest)) throw new Error(`checksum manifest not found: ${manifest}`)

  const entries = parseChecksumManifest(readFileSync(manifest, 'utf8'))
  for (const name of expected) {
    if (!entries.has(name)) throw new Error(`checksum missing for release asset: ${name}`)
    if (entries.get(name) !== hashes.get(name)) throw new Error(`checksum mismatch: ${name}`)
  }
  for (const name of entries.keys()) {
    if (!expected.includes(name)) throw new Error(`unexpected checksum manifest entry: ${name}`)
  }

  return { directory: root, version, platform, assets: expected }
}

function parseArgs(argv) {
  const options = { platform: 'all', writeManifest: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--write-manifest') options.writeManifest = true
    else if (['--dir', '--version', '--platform', '--manifest'].includes(arg)) {
      const value = argv[++i]
      if (!value) throw new Error(`${arg} requires a value`)
      if (arg === '--dir') options.directory = value
      else if (arg === '--version') options.version = value
      else if (arg === '--platform') options.platform = value
      else options.manifest = value
    } else throw new Error(`unknown argument: ${arg}`)
  }
  if (!options.directory) throw new Error('--dir is required')
  if (!options.version) throw new Error('--version is required')
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const result = await verifyReleaseAssets(options)
  console.log(
    `Verified ${result.assets.length} ${result.platform} release assets for v${result.version}.`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`release asset verification failed: ${error.message}`)
    process.exitCode = 1
  })
}
