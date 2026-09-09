import { createHash, timingSafeEqual } from 'node:crypto'

export type StoredImageExtension = 'png' | 'jpg'

export interface ImageAssetBinding {
  ownerId: number
  deckSessionId: string
  expectedRevision: number
  runId: string
  assetId: string
}

export interface PutImageAsset extends ImageAssetBinding {
  bytes: Uint8Array
  ext: StoredImageExtension
}

export interface StoredImageAssetHandle {
  assetId: string
  digest: string
  ext: StoredImageExtension
}

export interface GetImageAsset extends ImageAssetBinding {
  digest: string
}

export interface ResolvedImageAsset {
  bytes: Uint8Array
  ext: StoredImageExtension
}

export interface ImageAssetStoreOptions {
  ttlMs?: number
  maxEntries?: number
  now?: () => number
}

interface ImageAssetEntry extends ImageAssetBinding {
  bytes: Uint8Array
  ext: StoredImageExtension
  digest: string
  expiresAt: number
}

const DEFAULT_TTL_MS = 10 * 60_000
const DEFAULT_MAX_ENTRIES = 32
const SAFE_ID = /^[a-zA-Z0-9_-]{1,128}$/
const BOUNDARY_ID = /^[a-zA-Z0-9_-]{8,128}$/
const SHA256_HEX = /^[a-f0-9]{64}$/

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function digestMatches(left: string, right: string): boolean {
  if (!SHA256_HEX.test(left) || !SHA256_HEX.test(right)) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

function assertBinding(binding: ImageAssetBinding): void {
  if (!Number.isInteger(binding.ownerId) || binding.ownerId < 0)
    throw new Error('invalid generated image owner')
  if (!BOUNDARY_ID.test(binding.deckSessionId))
    throw new Error('invalid generated image deck session id')
  if (!Number.isInteger(binding.expectedRevision) || binding.expectedRevision < 0)
    throw new Error('invalid generated image revision')
  if (!BOUNDARY_ID.test(binding.runId)) throw new Error('invalid generated image run id')
  if (!SAFE_ID.test(binding.assetId)) throw new Error('invalid generated image asset id')
}

function entryKey(binding: ImageAssetBinding): string {
  return [
    binding.ownerId,
    binding.deckSessionId,
    binding.expectedRevision,
    binding.runId,
    binding.assetId,
  ].join('\0')
}

/** Main-process-only, bounded storage for normalized image bytes during one generation run. */
export class ImageAssetStore {
  private readonly entries = new Map<string, ImageAssetEntry>()
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number

  constructor(options: ImageAssetStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.now = options.now ?? Date.now
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0)
      throw new Error('image asset store ttl must be positive')
    if (!Number.isInteger(this.maxEntries) || this.maxEntries <= 0)
      throw new Error('image asset store maxEntries must be a positive integer')
  }

  put(asset: PutImageAsset): StoredImageAssetHandle {
    assertBinding(asset)
    if (asset.ext !== 'png' && asset.ext !== 'jpg')
      throw new Error('invalid generated image extension')
    if (!(asset.bytes instanceof Uint8Array) || asset.bytes.byteLength === 0)
      throw new Error('generated image asset bytes are empty')
    this.cleanup()
    const key = entryKey(asset)
    if (this.entries.has(key)) throw new Error('generated image asset already exists in this run')
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    const bytes = new Uint8Array(asset.bytes)
    const sha256 = digest(bytes)
    this.entries.set(key, {
      ownerId: asset.ownerId,
      deckSessionId: asset.deckSessionId,
      expectedRevision: asset.expectedRevision,
      runId: asset.runId,
      assetId: asset.assetId,
      ext: asset.ext,
      bytes,
      digest: sha256,
      expiresAt: this.now() + this.ttlMs,
    })
    return { assetId: asset.assetId, digest: sha256, ext: asset.ext }
  }

  get(request: GetImageAsset): ResolvedImageAsset {
    assertBinding(request)
    this.cleanup()
    const exact = this.entries.get(entryKey(request))
    if (!exact) {
      const candidate = [...this.entries.values()].find((entry) => entry.assetId === request.assetId)
      if (!candidate) throw new Error('unknown or expired generated image asset')
      if (candidate.ownerId !== request.ownerId) throw new Error('generated image asset belongs to another owner')
      if (candidate.deckSessionId !== request.deckSessionId)
        throw new Error('generated image asset belongs to another deck session')
      if (candidate.expectedRevision !== request.expectedRevision)
        throw new Error('generated image asset belongs to another revision')
      if (candidate.runId !== request.runId)
        throw new Error('generated image asset belongs to another generation run')
      throw new Error('unknown or expired generated image asset')
    }
    if (!digestMatches(exact.digest, request.digest))
      throw new Error('generated image asset digest mismatch')
    return { bytes: new Uint8Array(exact.bytes), ext: exact.ext }
  }

  revokeOwner(ownerId: number): void {
    for (const [key, entry] of this.entries)
      if (entry.ownerId === ownerId) this.entries.delete(key)
  }

  revokeDeck(ownerId: number, deckSessionId: string): void {
    for (const [key, entry] of this.entries)
      if (entry.ownerId === ownerId && entry.deckSessionId === deckSessionId)
        this.entries.delete(key)
  }

  revokeRun(ownerId: number, deckSessionId: string, runId: string): void {
    for (const [key, entry] of this.entries)
      if (
        entry.ownerId === ownerId &&
        entry.deckSessionId === deckSessionId &&
        entry.runId === runId
      )
        this.entries.delete(key)
  }

  cleanup(): void {
    const now = this.now()
    for (const [key, entry] of this.entries)
      if (entry.expiresAt <= now) this.entries.delete(key)
  }

  get size(): number {
    this.cleanup()
    return this.entries.size
  }
}
