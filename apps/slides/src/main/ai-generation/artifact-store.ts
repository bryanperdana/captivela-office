import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'

export interface StoredPageArtifact {
  schema: 'captivela.page-generation-artifact/v1'
  artifactId: string
  digest: string
}

interface ArtifactEntry {
  ownerId: number
  bytes: Uint8Array
  digest: string
  expiresAt: number
  expectedRevision?: number
  expectedSessionId?: string
}

export interface ArtifactStoreOptions {
  ttlMs?: number
  maxEntries?: number
  now?: () => number
  idFactory?: () => string
}

const DEFAULT_TTL_MS = 5 * 60_000
const DEFAULT_MAX_ENTRIES = 200
const SHA256_HEX = /^[a-f0-9]{64}$/

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function digestMatches(expected: string, actual: string): boolean {
  if (!SHA256_HEX.test(expected) || !SHA256_HEX.test(actual)) return false
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))
}

/**
 * Main-process-owned, bounded, one-time artifact store. Renderers receive only an opaque id + digest;
 * they never choose paths or read bytes directly.
 */
export class PageArtifactStore {
  private readonly entries = new Map<string, ArtifactEntry>()
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly now: () => number
  private readonly idFactory: () => string

  constructor(options: ArtifactStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) throw new Error('artifact ttl must be positive')
    if (!Number.isInteger(this.maxEntries) || this.maxEntries <= 0)
      throw new Error('artifact maxEntries must be a positive integer')
  }

  issue(
    ownerId: number,
    bytes: Uint8Array,
    expectedRevision?: number,
    expectedSessionId?: string,
  ): StoredPageArtifact {
    if (!Number.isInteger(ownerId) || ownerId < 0) throw new Error('invalid artifact owner')
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new Error('artifact bytes are empty')
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 0))
      throw new Error('invalid artifact revision')
    if (expectedSessionId !== undefined && !/^[a-zA-Z0-9_-]{8,128}$/.test(expectedSessionId))
      throw new Error('invalid artifact session id')
    this.cleanup()
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (!oldest) break
      this.entries.delete(oldest)
    }
    const artifactId = this.idFactory()
    if (!artifactId || this.entries.has(artifactId)) throw new Error('artifact id collision')
    const copy = new Uint8Array(bytes)
    const digest = sha256(copy)
    this.entries.set(artifactId, {
      ownerId,
      bytes: copy,
      digest,
      expiresAt: this.now() + this.ttlMs,
      expectedRevision,
      expectedSessionId,
    })
    return { schema: 'captivela.page-generation-artifact/v1', artifactId, digest }
  }

  consume(ownerId: number, artifact: StoredPageArtifact): Uint8Array {
    return this.consumeWithMetadata(ownerId, artifact).bytes
  }

  consumeWithMetadata(
    ownerId: number,
    artifact: StoredPageArtifact,
  ): { bytes: Uint8Array; expectedRevision?: number; expectedSessionId?: string } {
    if (
      !artifact ||
      typeof artifact !== 'object' ||
      Array.isArray(artifact) ||
      Object.keys(artifact).sort().join(',') !== 'artifactId,digest,schema'
    )
      throw new Error('invalid artifact envelope')
    if (artifact.schema !== 'captivela.page-generation-artifact/v1')
      throw new Error('unsupported artifact schema')
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(artifact.artifactId))
      throw new Error('invalid artifact id')
    this.cleanup()
    const entry = this.entries.get(artifact.artifactId)
    if (!entry) throw new Error('unknown or expired page artifact')
    if (entry.ownerId !== ownerId) throw new Error('page artifact belongs to another renderer')
    if (!digestMatches(entry.digest, artifact.digest)) throw new Error('page artifact digest mismatch')
    this.entries.delete(artifact.artifactId)
    return {
      bytes: new Uint8Array(entry.bytes),
      expectedRevision: entry.expectedRevision,
      expectedSessionId: entry.expectedSessionId,
    }
  }

  revokeOwner(ownerId: number): void {
    for (const [id, entry] of this.entries) if (entry.ownerId === ownerId) this.entries.delete(id)
  }

  cleanup(): void {
    const now = this.now()
    for (const [id, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(id)
  }

  get size(): number {
    this.cleanup()
    return this.entries.size
  }
}
